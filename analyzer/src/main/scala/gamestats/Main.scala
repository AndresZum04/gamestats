package gamestats

import cats.effect.{IO, IOApp}
import com.comcast.ip4s.{ipv4, Port}
import gamestats.http.Routes
import gamestats.store.ResultStore
import org.http4s.ember.server.EmberServerBuilder
import org.slf4j.LoggerFactory

import java.nio.file.Paths

/** Starts the analyzer: loads previous results and serves the API. */
object Main extends IOApp.Simple:
  private val log = LoggerFactory.getLogger("gamestats")

  def run: IO[Unit] =
    for
      env <- IO(sys.env)
      port <- IO.fromOption(env.get("PORT").orElse(Some("8081")).flatMap(Port.fromString))(
        IllegalArgumentException("PORT must be a valid port number")
      )
      resultsDir = Paths.get(env.getOrElse("RESULTS_DIR", "../data/results"))
      store <- ResultStore.load(resultsDir)
      _ <- IO(log.info(s"analyzer starting on port $port, results in $resultsDir"))
      _ <- EmberServerBuilder
        .default[IO]
        .withHost(ipv4"0.0.0.0")
        .withPort(port)
        .withHttpApp(Routes.withLogging(Routes(store).orNotFound))
        .build
        .useForever
    yield ()
