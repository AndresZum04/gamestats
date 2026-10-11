// Package blackjack generates blackjack matches: 2 to 4 players against
// the house, 10 rounds, 1000 chips each. The house is not a player: its
// events have no playerId.
package blackjack

import (
	"math/rand"
	"strconv"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// GameID of the blackjack game.
const GameID = "blackjack"

const (
	StartingChips = 1000
	Rounds        = 10
)

var (
	ranks = []string{"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"}
	suits = []string{"S", "H", "D", "C"}
)

// FullDeck returns the 52 cards in a fixed order ("AS", "2S", ... "KC").
func FullDeck() []string {
	deck := make([]string, 0, 52)
	for _, s := range suits {
		for _, r := range ranks {
			deck = append(deck, r+s)
		}
	}
	return deck
}

// NewDeck returns a shuffled 52-card deck.
func NewDeck(rng *rand.Rand) []string {
	deck := FullDeck()
	rng.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })
	return deck
}

// Rank is the card without its suit ("10H" -> "10").
func Rank(card string) string { return card[:len(card)-1] }

// HandValue counts aces as 11 while that does not go over 21.
func HandValue(cards []string) int {
	total, aces := 0, 0
	for _, c := range cards {
		switch r := Rank(c); r {
		case "A":
			total += 11
			aces++
		case "J", "Q", "K":
			total += 10
		default:
			n, _ := strconv.Atoi(r)
			total += n
		}
	}
	for total > 21 && aces > 0 {
		total -= 10
		aces--
	}
	return total
}

// Bettor decides a bet from the chips before it and the results of the
// player's previous hands (WIN, LOSE, PUSH). Build caps it to the chips.
type Bettor func(player string, round, chips int, history []string) int

// Spec describes a whole match. Each round deals from its own deck, from
// the top: first card of every player, dealer's up card, second card of
// every player, dealer's hidden card, then each player's extra cards in
// turn and the dealer's.
type Spec struct {
	Players []string
	Decks   [][]string
	Bet     Bettor
}

// Build plays the match with a simplified basic strategy: a player doubles
// on 10 or 11 with two cards (if the chips allow), otherwise hits below
// 17; the dealer hits below 17. dealerValue is always the dealer's real
// total, hidden card included: the log is written for analysis, not shown
// to the players.
func Build(b *match.Builder, spec Spec) {
	rng := b.Rng()
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{
		"players": spec.Players, "mode": "TABLE", "startingChips": StartingChips, "rounds": len(spec.Decks),
	})
	for i, p := range spec.Players {
		b.Add(match.Ms(100+10*i), "PLAYER_JOINED", p, "", nil)
	}

	chips := map[string]int{}
	history := map[string][]string{}
	for _, p := range spec.Players {
		chips[p] = StartingChips
	}
	active := append([]string{}, spec.Players...)
	t := 2 * time.Second
	next := func(ms int) time.Duration {
		t += match.Ms(ms)
		return t
	}

	for r, deck := range spec.Decks {
		if len(active) == 0 {
			break
		}
		round := r + 1
		deck := append([]string{}, deck...)
		draw := func() string {
			c := deck[0]
			deck = deck[1:]
			return c
		}
		b.Add(next(0), "ROUND_STARTED", "", "", map[string]any{"round": round})

		bets := map[string]int{}
		for _, p := range active {
			bets[p] = max(1, min(spec.Bet(p, round, chips[p], history[p]), chips[p]))
			b.Add(next(500), "BET_PLACED", p, "", map[string]any{"round": round, "amount": bets[p], "chipsBefore": chips[p]})
		}

		hands := map[string][]string{}
		var dealer []string
		dealPlayer := func(p string) {
			c := draw()
			hands[p] = append(hands[p], c)
			b.Add(next(400), "CARD_DEALT", p, "", map[string]any{"round": round, "card": c, "handValue": HandValue(hands[p])})
		}
		dealDealer := func(hidden bool) {
			c := draw()
			dealer = append(dealer, c)
			b.Add(next(400), "DEALER_CARD", "", "", map[string]any{"round": round, "card": c, "hidden": hidden, "dealerValue": HandValue(dealer)})
		}
		for _, p := range active {
			dealPlayer(p)
		}
		dealDealer(false)
		for _, p := range active {
			dealPlayer(p)
		}
		dealDealer(true)

		// Each player's turn. status: "" still in, "BUST" or "BLACKJACK".
		status := map[string]string{}
		standing := false
		for _, p := range active {
			b.Add(next(300), "TURN_STARTED", p, "", map[string]any{"turn": round})
			turnStart := t
			decide := func(action string) {
				b.Add(next(1000+rng.Intn(3000)), "DECISION", p, action, map[string]any{"round": round, "handValue": HandValue(hands[p])})
			}
			v := HandValue(hands[p])
			switch {
			case v == 21:
				status[p] = "BLACKJACK"
				b.Add(next(200), "BLACKJACK", p, "", map[string]any{"round": round})
			case (v == 10 || v == 11) && chips[p] >= 2*bets[p]:
				decide("DOUBLE")
				bets[p] *= 2
				dealPlayer(p)
			default:
				for HandValue(hands[p]) < 17 {
					decide("HIT")
					dealPlayer(p)
				}
				if HandValue(hands[p]) <= 21 {
					decide("STAND")
				}
			}
			if v := HandValue(hands[p]); v > 21 {
				status[p] = "BUST"
				b.Add(next(200), "BUST", p, "", map[string]any{"round": round, "handValue": v})
			}
			standing = standing || status[p] == ""
			b.Add(next(100), "TURN_ENDED", p, "", map[string]any{"turn": round, "durationMs": int((t - turnStart) / time.Millisecond)})
		}

		// The dealer only draws when someone is still waiting for it.
		if standing {
			for HandValue(dealer) < 17 {
				dealDealer(false)
			}
		}
		dv := HandValue(dealer)
		dealerBJ := len(dealer) == 2 && dv == 21

		var still []string
		for _, p := range active {
			result, payout := "PUSH", 0
			v := HandValue(hands[p])
			switch {
			case status[p] == "BUST":
				result, payout = "LOSE", -bets[p]
			case status[p] == "BLACKJACK" && !dealerBJ:
				result, payout = "WIN", bets[p]*3/2
			case status[p] == "BLACKJACK":
			case dealerBJ || (dv <= 21 && v < dv):
				result, payout = "LOSE", -bets[p]
			case dv > 21 || v > dv:
				result, payout = "WIN", bets[p]
			}
			chips[p] += payout
			history[p] = append(history[p], result)
			b.Add(next(300), "HAND_RESULT", p, "", map[string]any{"round": round, "result": result, "payout": payout, "chips": chips[p]})
		}
		for _, p := range active {
			if chips[p] == 0 {
				b.Add(next(1000), "PLAYER_LEFT", p, "", map[string]any{"reason": "NO_CHIPS"})
			} else {
				still = append(still, p)
			}
		}
		active = still
		next(3000)
	}

	b.Add(t, "MATCH_FINISHED", "", "", map[string]any{
		"durationMs": int(t / time.Millisecond), "results": match.Results(spec.Players, chips, "chips"),
	})
}

// Generate plays a random match with 2 to 4 of the given players and a
// fresh shuffled deck per round. Each player bets a fixed share of the
// chips; after two losses in a row a player may go all in.
func Generate(b *match.Builder, players []string) {
	rng := b.Rng()
	n := 2 + rng.Intn(3)
	share := map[string]float64{}
	tilt := map[string]float64{}
	for _, p := range players[:n] {
		share[p] = []float64{0.05, 0.1, 0.2}[rng.Intn(3)]
		tilt[p] = rng.Float64() * 0.6
	}
	spec := Spec{Players: players[:n]}
	for range Rounds {
		spec.Decks = append(spec.Decks, NewDeck(rng))
	}
	spec.Bet = func(p string, _, chips int, history []string) int {
		if k := len(history); k >= 2 && history[k-1] == "LOSE" && history[k-2] == "LOSE" && rng.Float64() < tilt[p] {
			return chips
		}
		return max(10, int(float64(chips)*share[p])/10*10)
	}
	Build(b, spec)
}
