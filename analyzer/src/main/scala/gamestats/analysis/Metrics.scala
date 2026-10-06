package gamestats.analysis

import io.circe.Json

/** Metrics of each player in one match: playerId -> metric name -> value. */
type PlayerMetrics = Map[String, Map[String, Json]]

object Metrics:

  /** Combines several per-player maps; on a repeated metric the later map wins. Built with foldLeft
    * and ++, never by mutating a map.
    */
  def merge(maps: PlayerMetrics*): PlayerMetrics =
    maps.foldLeft(Map.empty: PlayerMetrics) { (acc, next) =>
      next.foldLeft(acc) { case (a, (player, metrics)) =>
        a.updated(player, a.getOrElse(player, Map.empty) ++ metrics)
      }
    }

  /** A decimal rounded to `decimals` places, as JSON. */
  def num(value: Double, decimals: Int = 1): Json =
    Json.fromBigDecimal(BigDecimal(value).setScale(decimals, BigDecimal.RoundingMode.HALF_UP))

  def int(value: Long): Json = Json.fromLong(value)

  def bool(value: Boolean): Json = Json.fromBoolean(value)

  def str(value: String): Json = Json.fromString(value)

  /** Average of a non-empty list; None for an empty one (no division by 0). */
  def average(values: List[Double]): Option[Double] =
    if values.isEmpty then None else Some(values.sum / values.size)
