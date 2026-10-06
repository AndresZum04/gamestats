package gamestats

import cats.effect.{IO, IOApp}

// Punto de entrada mínimo. El servidor HTTP se levanta en T11.
object Main extends IOApp.Simple:
  def run: IO[Unit] = IO.println("analyzer starting")
