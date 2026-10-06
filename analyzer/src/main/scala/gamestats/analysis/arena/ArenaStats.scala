package gamestats.analysis.arena

import gamestats.analysis.Metrics
import gamestats.model.ArenaEvent
import gamestats.model.ArenaEvent.*
import io.circe.Json

/** arena-clash statistics A1 to A5, and the per-match input of A6. Pure functions over the typed
  * events of one match.
  */
object ArenaStats:

  final case class Combat(kills: Int, deaths: Int, assists: Int):
    /** K/D with at least one death in the divisor: no division by zero. */
    def kd: Double = kills.toDouble / math.max(deaths, 1)

  final case class Damage(total: Double, hits: Int, headshots: Int)

  def eliminations(events: List[ArenaEvent]): List[PlayerEliminated] =
    events.collect { case k: PlayerEliminated => k }

  def hits(events: List[ArenaEvent]): List[DamageDealt] =
    events.collect { case d: DamageDealt => d }

  private def countBy[A](xs: List[A])(key: A => String): Map[String, Int] =
    xs.groupBy(key).view.mapValues(_.size).toMap

  /** A1: eliminations, deaths (read by victimId) and assists (flatMap over assistIds), folded into
    * one Combat per player.
    */
  def combat(events: List[ArenaEvent], players: List[String]): Map[String, Combat] =
    val kills = eliminations(events)
    val byKiller = countBy(kills)(_.playerId)
    val byVictim = countBy(kills)(_.victimId)
    val byAssist = countBy(kills.flatMap(_.assistIds))(identity)
    (players.toSet ++ byKiller.keySet ++ byVictim.keySet ++ byAssist.keySet).toList
      .map(p =>
        p -> Combat(byKiller.getOrElse(p, 0), byVictim.getOrElse(p, 0), byAssist.getOrElse(p, 0))
      )
      .toMap

  /** A2 (damage part): total, hits and headshots per attacker. */
  def damage(events: List[ArenaEvent]): Map[String, Damage] =
    hits(events)
      .groupBy(_.playerId)
      .view
      .mapValues { hs =>
        val (headshots, _) = hs.partition(_.headshot)
        Damage(hs.map(_.amount).sum, hs.size, headshots.size)
      }
      .toMap

  /** A2 (distance part): the longest elimination of each player. */
  def longestKill(events: List[ArenaEvent]): Map[String, Double] =
    eliminations(events)
      .groupBy(_.playerId)
      .flatMap((p, ks) => ks.maxByOption(_.distanceM).map(k => p -> k.distanceM))

  /** A4 (combines DAMAGE_DEALT and PLAYER_ELIMINATED): damage needed per elimination. The two
    * groupings are zipped by player; players without eliminations get nothing.
    */
  def damagePerKill(events: List[ArenaEvent]): Map[String, Double] =
    val dealt = damage(events).view.mapValues(_.total).toMap
    val kills = countBy(eliminations(events))(_.playerId)
    kills.toList.flatMap((p, k) => dealt.get(p).map(d => p -> d / k)).toMap

  /** A5 (combines ITEM_PICKED and PLAYER_ELIMINATED): share of weapon pickups followed by an
    * elimination by the same player within 30 s.
    */
  def weaponConversion(events: List[ArenaEvent], windowMs: Long = 30000): Map[String, Double] =
    val kills = eliminations(events)
    events
      .collect { case i: ItemPicked if i.itemType == "WEAPON" => i }
      .groupBy(_.playerId)
      .map { (p, pickups) =>
        val converted = pickups.count { pick =>
          kills.exists(k =>
            k.playerId == p && k.meta.atMs > pick.meta.atMs && k.meta.atMs - pick.meta.atMs <= windowMs
          )
        }
        p -> 100.0 * converted / pickups.size
      }

  /** MVP score of the plan: 2 x eliminations + assists + damage / 100. */
  def mvpScore(c: Combat, d: Option[Damage]): Double =
    2.0 * c.kills + c.assists + d.fold(0.0)(_.total) / 100

  /** A3: score, winner, first blood, damage by team and MVP. The score is counted from the
    * eliminations, so it also exists for PARTIAL matches; the winner only comes from
    * MATCH_FINISHED.
    */
  def matchSummary(
      events: List[ArenaEvent],
      teams: Map[String, String],
      players: List[String],
      winner: Option[String]
  ): Map[String, Json] =
    val kills = eliminations(events)
    val score = countBy(kills)(k => teams.getOrElse(k.playerId, "NONE"))
    val damageByTeam = hits(events)
      .groupBy(h => teams.getOrElse(h.playerId, "NONE"))
      .view
      .mapValues(_.map(_.amount).sum)
    val stats = combat(events, players)
    val dmg = damage(events)
    val mvp = stats.toList
      .map((p, c) => p -> mvpScore(c, dmg.get(p)))
      .sortBy((p, s) => (-s, p)) // highest score; on a tie, the first id alphabetically
      .headOption
    val firstBlood = kills.sortBy(_.meta.seq).headOption

    Map(
      "score" -> Json.fromFields(
        List("RED", "BLUE").map(t => t -> Json.fromInt(score.getOrElse(t, 0)))
      ),
      "damageByTeam" -> Json.fromFields(
        List("RED", "BLUE").map(t => t -> Metrics.num(damageByTeam.getOrElse(t, 0.0)))
      ),
      "eliminations" -> Json.fromInt(kills.size),
      "killsByWeapon" -> Json.fromFields(
        countBy(kills)(_.weapon).toList.sorted.map((w, n) => w -> Json.fromInt(n))
      )
    ) ++
      winner.map(w => "winnerTeam" -> Json.fromString(w)) ++
      firstBlood.map(k =>
        "firstBlood" -> Json.obj(
          "playerId" -> Json.fromString(k.playerId),
          "victimId" -> Json.fromString(k.victimId),
          "atMs" -> Json.fromLong(k.meta.atMs)
        )
      ) ++
      mvp.map((p, s) =>
        "mvp" -> Json.obj("playerId" -> Json.fromString(p), "score" -> Metrics.num(s, 2))
      )
