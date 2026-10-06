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

  def batch(matchId: String = "rp-0007", gameId: String = "racing-pro"): String =
    s"""{"batchId":"b-1","matchId":"$matchId","gameId":"$gameId","gameVersion":"1.0","status":"COMPLETE",
       |"startedAt":"2026-09-10T14:00:00.000Z","finishedAt":"2026-09-10T14:16:05.300Z",
       |"players":["p-ana","p-luis","p-sofi"],"eventCount":10,"sentAt":"2026-09-10T14:16:06.000Z",
       |"events":[${examples.take(10).mkString(",")}]}""".stripMargin

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
      assertEquals(json.hcursor.get[String]("matchId"), Right("rp-0007"))
      assertEquals(json.hcursor.get[Int]("patternsFound"), Right(0))
      assert(Files.exists(dir.resolve("rp-0007.json")))

      val (getStatus, analysis) = run(app, Request[IO](Method.GET, uri"/api/v1/matches/rp-0007"))
      assertEquals(getStatus, Status.Ok)
      assertEquals(analysis.hcursor.get[Long]("durationMs"), Right(965300L))
      assertEquals(analysis.hcursor.downField("eventsByType").get[Int]("LAP_COMPLETED"), Right(1))
    }
  }

  test("results survive a restart") {
    withApp { (app, dir) =>
      run(app, post(batch()))
      val reloaded = ResultStore.load(dir).unsafeRunSync()
      assertEquals(reloaded.get("rp-0007").unsafeRunSync().map(_.durationMs), Some(965300L))
    }
  }

  test("sending the same match again replaces it") {
    withApp { (app, dir) =>
      run(app, post(batch()))
      run(app, post(batch()))
      assertEquals(Files.list(dir).iterator().asScala.count(_.toString.endsWith(".json")), 1)
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
          """{"matchId":"rp-1"}""",
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

  test("aggregate endpoints answer with data for racing and combat") {
    import gamestats.codec.Codecs.given
    import io.circe.syntax.*
    withApp { (app, _) =>
      List("rp-scn-comeback", "rp-scn-steady", "ac-scn-spree", "ac-scn-teamback")
        .map(gamestats.fixtures.Samples.scenario)
        .foreach(b => assertEquals(run(app, post(b.asJson.noSpaces))._1, Status.Ok))

      def get(path: String): (Status, Json) =
        run(app, Request[IO](Method.GET, Uri.unsafeFromString(path)))

      val (_, matches) = get("/api/v1/matches?gameId=arena-clash")
      assertEquals(matches.asArray.map(_.size), Some(2))
      assertEquals(get("/api/v1/matches?limit=1")._2.asArray.map(_.size), Some(1))
      assertEquals(
        get("/api/v1/players/p-ana")._2.hcursor.downField("games").values.map(_.size),
        Some(2)
      )
      assertEquals(
        get("/api/v1/games/racing-pro/leaderboard")._2.hcursor.get[String]("metric"),
        Right("consistency")
      )
      assertEquals(
        get("/api/v1/games/arena-clash/summary")._2.hcursor.get[Int]("matches"),
        Right(2)
      )
      assertEquals(get("/api/v1/patterns")._2.asArray.map(_.size), Some(4))
      assertEquals(get("/api/v1/patterns?patternId=P5")._2.asArray.map(_.size), Some(1))

      assertEquals(get("/api/v1/players/nobody")._1, Status.NotFound)
      assertEquals(get("/api/v1/games/chess-lite/summary")._1, Status.NotFound)
      for bad <- List("0", "1001", "abc") do
        assertEquals(get(s"/api/v1/matches?limit=$bad")._1, Status.BadRequest)
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
