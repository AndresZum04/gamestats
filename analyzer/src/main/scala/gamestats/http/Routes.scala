package gamestats.http

import cats.data.Kleisli
import cats.effect.IO
import gamestats.analysis.AnalyzerRegistry
import gamestats.codec.Codecs.given
import gamestats.model.{MatchAnalysis, MatchBatch}
import gamestats.store.ResultStore
import io.circe.Json
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.*
import org.http4s.dsl.io.*
import org.slf4j.LoggerFactory

import java.time.Instant

/** HTTP layer: decodes, calls the pure analysis, stores and answers. All effects (clock, files,
  * logs) live here and in the store, never in the analysis package.
  */
object Routes:
  private val log = LoggerFactory.getLogger("gamestats.http")

  /** Same rule as schemas/event.schema.json; matchId becomes a file name. */
  private val matchIdPattern = "^[A-Za-z0-9_-]{1,128}$".r

  private def error(msg: String): Json = Json.obj("error" -> Json.fromString(msg))

  def apply(store: ResultStore): HttpRoutes[IO] = HttpRoutes.of[IO] {
    case GET -> Root / "health" => Ok(Json.obj("status" -> Json.fromString("ok")))

    case req @ POST -> Root / "api" / "v1" / "matches" =>
      req.attemptAs[MatchBatch](jsonOf[IO, MatchBatch]).value.flatMap {
        case Left(failure) => BadRequest(error(s"invalid batch: ${failure.message}"))
        case Right(batch) if batch.gameId.isBlank => BadRequest(error("gameId is empty"))
        case Right(batch) if !matchIdPattern.matches(batch.matchId) =>
          BadRequest(error("invalid matchId"))
        case Right(batch) => analyzeAndStore(store, batch)
      }

    case GET -> Root / "api" / "v1" / "matches" / matchId =>
      store.get(matchId).flatMap {
        case Some(a) => Ok(a.asJson)
        case None    => NotFound(error(s"match $matchId not found"))
      }
  }

  private def analyzeAndStore(store: ResultStore, batch: MatchBatch): IO[Response[IO]] =
    for
      now <- IO.realTimeInstant
      analysis = AnalyzerRegistry.forGame(batch.gameId).analyze(batch).copy(analyzedAt = now)
      _ <- store.put(analysis)
      _ <- IO(log.info(summary(analysis)))
      resp <- Ok(
        Json.obj(
          "matchId" -> Json.fromString(analysis.matchId),
          "patternsFound" -> Json.fromInt(analysis.patterns.size),
          "analyzedAt" -> (analysis.analyzedAt: Instant).asJson
        )
      )
    yield resp

  private def summary(a: MatchAnalysis): String =
    s"analyzed matchId=${a.matchId} gameId=${a.gameId} partial=${a.partial} " +
      s"events=${a.eventsByType.values.sum} patterns=${a.patterns.size}"

  /** Logs method, path, status and duration of every request but /health, and turns unexpected
    * failures into a JSON 500.
    */
  def withLogging(app: HttpApp[IO]): HttpApp[IO] = Kleisli { req =>
    for
      start <- IO.monotonic
      resp <- app(req).handleErrorWith { err =>
        IO(log.error(s"${req.method} ${req.uri.path} failed", err)) *>
          InternalServerError(error("internal error"))
      }
      end <- IO.monotonic
      _ <-
        if req.uri.path.renderString == "/health" then IO.unit
        else
          IO(
            log.info(
              s"${req.method} ${req.uri.path} ${resp.status.code} ${(end - start).toMillis}ms"
            )
          )
    yield resp
  }
