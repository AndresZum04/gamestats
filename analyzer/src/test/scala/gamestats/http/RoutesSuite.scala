package gamestats.http

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import gamestats.store.ResultStore
import io.circe.Json
import io.circe.parser.parse
import org.http4s.*
import org.http4s.circe.*
import org.http4s.implicits.*

import java.nio.file.{Files, Path, Paths}
import scala.jdk.CollectionConverters.*

/** Routes tested in memory: no port is opened. */
class RoutesSuite extends munit.FunSuite:

  val examples: List[String] =
    Files
      .readAllLines(Paths.get("../data/samples/examples.jsonl"))
      .asScala
      .toList
      .filter(_.trim.nonEmpty)

  def batch(
      matchId: String = "tv-0007",
      gameId: String = "trivia",
      status: String = "COMPLETE",
      events: Int = 10
  ): String =
    s"""{"batchId":"b-1","matchId":"$matchId","gameId":"$gameId","gameVersion":"1.0","status":"$status",
       |"startedAt":"2026-09-10T14:00:00.000Z","finishedAt":"2026-09-10T14:04:10.000Z",
       |"players":["p-ana","p-luis","p-sofi"],"eventCount":$events,"sentAt":"2026-09-10T14:04:11.000Z",
       |"events":[${examples.take(events).mkString(",")}]}""".stripMargin

  def withApp[A](f: (HttpApp[IO], Path) => A): A =
    val dir = Files.createTempDirectory("results")
    val store = ResultStore.load(dir).unsafeRunSync()
    f(Routes.withLogging(Routes(store).orNotFound), dir)

  def run(app: HttpApp[IO], req: Request[IO]): (Status, Json) =
    val resp = app(req).unsafeRunSync()
    (resp.status, resp.as[Json].unsafeRunSync())

  def post(body: String): Request[IO] =
    Request[IO](Method.POST, uri"/api/v1/matches").withEntity(body)

  test("POST a batch: 200, analysis stored on disk and served by GET") {
    withApp { (app, dir) =>
      val (status, json) = run(app, post(batch()))
      assertEquals(status, Status.Ok)
      assertEquals(json.hcursor.get[String]("matchId"), Right("tv-0007"))
      assertEquals(json.hcursor.get[Int]("patternsFound"), Right(0))
      assert(Files.exists(dir.resolve("tv-0007.json")))

      val (getStatus, analysis) = run(app, Request[IO](Method.GET, uri"/api/v1/matches/tv-0007"))
      assertEquals(getStatus, Status.Ok)
      assertEquals(analysis.hcursor.get[Long]("durationMs"), Right(250000L))
      assertEquals(
        analysis.hcursor.downField("eventsByType").get[Int]("ANSWER_SUBMITTED"),
        Right(1)
      )
    }
  }

  test("results survive a restart") {
    withApp { (app, dir) =>
      run(app, post(batch()))
      val reloaded = ResultStore.load(dir).unsafeRunSync()
      assertEquals(reloaded.get("tv-0007").unsafeRunSync().map(_.durationMs), Some(250000L))
    }
  }

  test("sending the same match again replaces it") {
    withApp { (app, dir) =>
      run(app, post(batch()))
      run(app, post(batch()))
      assertEquals(Files.list(dir).iterator().asScala.count(_.toString.endsWith(".json")), 1)
    }
  }

  test("a COMPLETE batch replaces the LIVE copy; a late LIVE copy never replaces a newer result") {
    withApp { (app, dir) =>
      def stored(body: String): Boolean =
        run(app, post(body))._2.hcursor
          .get[Boolean]("stored")
          .fold(err => fail(err.toString), identity)
      def get(path: String): Json = run(app, Request[IO](Method.GET, Uri.unsafeFromString(path)))._2
      def ids(path: String): Vector[String] =
        get(path).asArray.toVector.flatten.flatMap(_.hcursor.get[String]("matchId").toOption)
      def live: Either[io.circe.DecodingFailure, Boolean] =
        get("/api/v1/matches/tv-0007").hcursor.get[Boolean]("live")

      assert(stored(batch(status = "LIVE", events = 6)))
      assertEquals(ids("/api/v1/matches?live=true"), Vector("tv-0007"))
      assertEquals(ids("/api/v1/matches"), Vector.empty)
      assert(!stored(batch(status = "LIVE", events = 4)), "an older copy that arrives late")
      assert(stored(batch(status = "LIVE", events = 8)))

      assert(stored(batch()))
      assertEquals((live, ids("/api/v1/matches?live=true")), (Right(false), Vector.empty))
      assertEquals(ids("/api/v1/matches?live=false"), Vector("tv-0007"))
      assert(!stored(batch(status = "LIVE", events = 10)), "a copy sent before the COMPLETE")
      assertEquals(live, Right(false))
      val reloaded = ResultStore.load(dir).unsafeRunSync()
      assertEquals(reloaded.get("tv-0007").unsafeRunSync().map(_.live), Some(false))
    }
  }

  test("a game without its own analyzer still gets generic statistics") {
    withApp { (app, _) =>
      val (status, _) = run(app, post(batch(matchId = "x-1", gameId = "card-duel")))
      assertEquals(status, Status.Ok)
    }
  }

  test("400 for a body that does not decode, an empty gameId or an unsafe matchId") {
    withApp { (app, dir) =>
      for body <- List(
          "{not json",
          """{"matchId":"tv-1"}""",
          batch(gameId = " "),
          batch(matchId = "../evil")
        )
      do
        val (status, json) = run(app, post(body))
        assertEquals(status, Status.BadRequest, body)
        assert(json.hcursor.get[String]("error").isRight)
      assert(!Files.exists(dir.resolveSibling("evil.json")))
    }
  }

  test("404 for an unknown match and for unknown routes, 200 for /health") {
    withApp { (app, _) =>
      assertEquals(run(app, Request[IO](Method.GET, uri"/api/v1/matches/nope"))._1, Status.NotFound)
      assertEquals(
        app(Request[IO](Method.GET, uri"/nothing")).unsafeRunSync().status,
        Status.NotFound
      )
      assertEquals(
        run(app, Request[IO](Method.GET, uri"/health")),
        (Status.Ok, parse("""{"status":"ok"}""").toOption.get)
      )
    }
  }

  test("aggregate endpoints answer with data for every game") {
    import gamestats.codec.Codecs.given
    import io.circe.syntax.*
    withApp { (app, _) =>
      List("tv-scn-streak", "tv-scn-comeback", "sn-scn-frenzy", "bj-scn-hot")
        .map(gamestats.fixtures.Samples.scenario)
        .foreach(b => assertEquals(run(app, post(b.asJson.noSpaces))._1, Status.Ok))

      def get(path: String): (Status, Json) =
        run(app, Request[IO](Method.GET, Uri.unsafeFromString(path)))

      val (_, matches) = get("/api/v1/matches?gameId=trivia")
      assertEquals(matches.asArray.map(_.size), Some(2))
      assertEquals(get("/api/v1/matches?limit=1")._2.asArray.map(_.size), Some(1))
      assertEquals(
        get("/api/v1/players/p-ana")._2.hcursor.downField("games").values.map(_.size),
        Some(1)
      )
      assertEquals(
        get("/api/v1/games/trivia/leaderboard")._2.hcursor.get[String]("metric"),
        Right("correctPct")
      )
      assertEquals(
        get("/api/v1/games/trivia/summary")._2.hcursor.get[Int]("matches"),
        Right(2)
      )
      assertEquals(
        get("/api/v1/games/snake/summary")._2.hcursor
          .downField("gameMetrics")
          .downField("lengthRecord")
          .get[String]("matchId"),
        Right("sn-scn-frenzy")
      )
      // One pattern per scenario: P1, P2, P3 and P5.
      assertEquals(get("/api/v1/patterns")._2.asArray.map(_.size), Some(4))
      assertEquals(get("/api/v1/patterns?patternId=P5")._2.asArray.map(_.size), Some(1))
      val summary = get("/api/v1/summary")._2.hcursor
      assertEquals(summary.get[Int]("matches"), Right(4))
      assertEquals(summary.downField("matchesByGame").get[Int]("trivia"), Right(2))
      assertEquals(summary.downField("patternsByType").get[Int]("P5"), Right(1))

      assertEquals(get("/api/v1/players/nobody")._1, Status.NotFound)
      assertEquals(get("/api/v1/games/card-duel/summary")._1, Status.NotFound)
      for bad <- List("0", "1001", "abc") do
        assertEquals(get(s"/api/v1/matches?limit=$bad")._1, Status.BadRequest)
      assertEquals(get("/api/v1/matches?live=yes")._1, Status.BadRequest)
    }
  }

  test("GET /dashboard serves the HTML board and / redirects to it") {
    withApp { (app, _) =>
      val resp = app(Request[IO](Method.GET, uri"/dashboard")).unsafeRunSync()
      assertEquals(resp.status, Status.Ok)
      assert(resp.contentType.exists(_.mediaType == MediaType.text.html))
      assert(resp.as[String].unsafeRunSync().contains("<title>GameStats</title>"))
      val root = app(Request[IO](Method.GET, uri"/")).unsafeRunSync()
      assertEquals(root.status, Status.SeeOther)
    }
  }
