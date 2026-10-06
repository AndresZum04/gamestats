package gamestats.store

import cats.effect.{IO, Ref}
import cats.syntax.all.*
import gamestats.codec.Codecs.given
import gamestats.model.MatchAnalysis
import io.circe.parser.decode
import io.circe.syntax.*
import org.slf4j.LoggerFactory

import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path, StandardCopyOption}
import java.util.UUID
import scala.jdk.CollectionConverters.*

/** Analyzed matches: in memory in a Ref (atomic, safe for concurrent requests) and on disk as
  * RESULTS_DIR/{matchId}.json, so they survive a restart and can be read by the future dashboard.
  */
final class ResultStore private (dir: Path, ref: Ref[IO, Map[String, MatchAnalysis]]):

  /** Saves an analysis, replacing a previous one of the same match: a retry from the ingestor never
    * duplicates data. The file is written first, so memory never shows a result that is not on
    * disk.
    */
  def put(a: MatchAnalysis): IO[Unit] =
    ResultStore.writeFile(dir, a) *> ref.update(_.updated(a.matchId, a))

  def get(matchId: String): IO[Option[MatchAnalysis]] = ref.get.map(_.get(matchId))

  /** Every stored analysis. Routes read it once and pass the list to the pure functions of the
    * analysis package.
    */
  def all: IO[List[MatchAnalysis]] = ref.get.map(_.values.toList)

object ResultStore:
  private val log = LoggerFactory.getLogger("gamestats.store")

  /** Creates the folder if needed and loads every result already in it. */
  def load(dir: Path): IO[ResultStore] =
    for
      _ <- IO.blocking(Files.createDirectories(dir))
      loaded <- readAll(dir)
      _ <- IO(log.info(s"loaded ${loaded.size} results from $dir"))
      ref <- Ref.of[IO, Map[String, MatchAnalysis]](loaded.map(a => a.matchId -> a).toMap)
    yield ResultStore(dir, ref)

  private def readAll(dir: Path): IO[List[MatchAnalysis]] =
    IO.blocking(Files.list(dir).iterator().asScala.toList)
      .map(_.filter(_.getFileName.toString.endsWith(".json")).sortBy(_.toString))
      .flatMap(_.traverse(readOne).map(_.flatten))

  /** A broken file is logged and skipped: one bad result must not stop the service from starting.
    */
  private def readOne(file: Path): IO[Option[MatchAnalysis]] =
    IO.blocking(Files.readString(file, UTF_8)).map(decode[MatchAnalysis]).flatMap {
      case Right(a) => IO.pure(Some(a))
      case Left(err) =>
        IO(log.warn(s"skipping unreadable result $file: ${err.getMessage}")).as(None)
    }

  /** Writes to a unique temp file and renames it, so two requests for the same match never leave a
    * mixed file and a crash never leaves half of one.
    */
  private def writeFile(dir: Path, a: MatchAnalysis): IO[Unit] = IO.blocking {
    val target = dir.resolve(s"${a.matchId}.json")
    val tmp = dir.resolve(s"${a.matchId}.${UUID.randomUUID()}.tmp")
    Files.writeString(tmp, a.asJson.spaces2, UTF_8)
    Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
  }.void
