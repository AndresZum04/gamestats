/*  Tests of the blackjack AI.
    swipl -g run_tests -t halt prolog/tests/blackjack_ai.plt
*/
:- use_module('../blackjack_ai').
:- use_module(library(plunit)).

%   A full shoe of 6 decks: 24 of each value and 96 tens (10, J, Q, K).
full_shoe(Counts) :-
    findall(V-C, ( between(1, 10, V), ( V =:= 10 -> C = 96 ; C = 24 ) ), Counts).

%   A shoe rich in tens and aces: many low cards (2 to 6) already played.
rich_shoe(Counts) :-
    findall(V-C, ( between(1, 10, V),
                   ( V =:= 10 -> C = 96 ; V =:= 1 -> C = 24 ; V =< 6 -> C = 4 ; C = 24 ) ),
            Counts).

action(Hand, Up, CanDouble, Action) :-
    full_shoe(Shoe),
    decide(Hand, Up, Shoe, CanDouble, D),
    Action = D.decision.

:- begin_tests(cards).

test(values) :-
    card_value("10H", 10), card_value("KS", 10), card_value("AD", 1), card_value("7C", 7).

test(soft_hands) :-
    hand_state([1, 6], 17, true),
    hand_state([1, 6, 9], 16, false),
    hand_state([1, 1], 12, true),
    hand_state([10, 6], 16, false).

:- end_tests(cards).

:- begin_tests(dealer).

test(distribution_sums_to_one) :-
    full_shoe(S), shoe_probs(S, P),
    forall(between(2, 11, Up),
           ( ( Up =:= 11 -> T = 11, Soft = true ; T = Up, Soft = false ),
             dealer_dist(P, T, Soft, D),
             sum_list(D, Sum),
             abs(Sum - 1) < 1.0e-9 )).

test(six_busts_more_than_ten) :-
    full_shoe(S), shoe_probs(S, P),
    dealer_dist(P, 6, false, D6), last(D6, Bust6),
    dealer_dist(P, 10, false, D10), last(D10, Bust10),
    Bust6 > Bust10.

test(stands_on_soft_17) :-
    full_shoe(S), shoe_probs(S, P),
    dealer_dist(P, 17, true, [1, 0, 0, 0, 0, 0]).

:- end_tests(dealer).

:- begin_tests(decisions).

test(hit_16_against_10) :-
    action(["10H", "6S"], "10D", false, 'HIT').

test(stand_12_against_6) :-
    action(["10H", "2S"], "6D", false, 'STAND').

test(double_11_against_6) :-
    action(["6H", "5S"], "6D", true, 'DOUBLE').

test(no_double_when_not_allowed) :-
    full_shoe(S),
    decide(["6H", "5S"], "6D", S, false, D),
    D.decision == 'HIT',
    D.evDouble == null.

test(stand_hard_20) :-
    action(["10H", "QS"], "10D", false, 'STAND'),
    action(["10H", "QS"], "6D", true, 'STAND').

test(hit_soft_18_against_9) :-
    action(["AH", "7S"], "9D", false, 'HIT').

test(evs_and_reason) :-
    full_shoe(S),
    decide(["10H", "6S"], "9D", S, false, D),
    D.evHit > D.evStand,
    D.evStand < 0,
    sub_string(D.reason, 0, _, _, "pedir: EV").

:- end_tests(decisions).

:- begin_tests(bet).

test(minimum_with_a_fresh_shoe) :-
    full_shoe(S),
    bet(S, 1000, 10, 200, 10, TC),
    TC =:= 0.

test(bet_goes_up_with_a_high_true_count) :-
    full_shoe(Full), rich_shoe(Rich),
    bet(Full, 1000, 10, 200, Low, _),
    bet(Rich, 1000, 10, 200, High, TC),
    TC > 2,
    High > Low.

test(limited_by_max_bet_and_chips) :-
    rich_shoe(Rich),
    bet(Rich, 1000, 10, 40, 40, _),
    bet(Rich, 25, 10, 200, 20, _).

:- end_tests(bet).
