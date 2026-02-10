package buildtool

import (
	"fmt"
	"os"
	"strings"
)

func validateCardRefs(battleboxes []Battlebox) error {
	var issues []string

	for _, bb := range battleboxes {
		deckCards := make(map[string]map[string]struct{}, len(bb.Decks))
		for _, deck := range bb.Decks {
			set := make(map[string]struct{})
			for _, card := range deck.Cards {
				key := normalizeName(card.Name)
				if key != "" {
					set[key] = struct{}{}
				}
			}
			for _, card := range deck.Sideboard {
				key := normalizeName(card.Name)
				if key != "" {
					set[key] = struct{}{}
				}
			}
			deckCards[deck.Slug] = set
		}

		for _, deck := range bb.Decks {
			if deck.Primer != "" {
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "primer", deck.Primer, deckCards[deck.Slug], nil)...)
			}
			for opponent, guide := range deck.Guides {
				opponentSet := deckCards[opponent]
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "guide:"+opponent, guide.Text, deckCards[deck.Slug], opponentSet)...)
			}
		}
	}

	if len(issues) == 0 {
		return nil
	}

	for _, issue := range issues {
		fmt.Fprintln(os.Stderr, issue)
	}
	return fmt.Errorf("card reference validation failed (%d)", len(issues))
}

func validateRefsForText(battlebox, deck, source, text string, deckSet, opponentSet map[string]struct{}) []string {
	if text == "" {
		return nil
	}
	var issues []string
	for _, ref := range extractCardRefs(text) {
		key := normalizeName(ref)
		if key == "" {
			continue
		}
		if containsCard(deckSet, key) || containsCard(opponentSet, key) {
			continue
		}
		issues = append(issues, fmt.Sprintf("Missing card ref (%s/%s %s): %s", battlebox, deck, source, ref))
	}
	return issues
}

func containsCard(set map[string]struct{}, key string) bool {
	if set == nil {
		return false
	}
	_, ok := set[key]
	return ok
}

func extractCardRefs(text string) []string {
	matches := cardRefRE.FindAllStringSubmatch(text, -1)
	if matches == nil {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		inner := strings.TrimSpace(match[1])
		if inner == "" {
			continue
		}
		parts := strings.SplitN(inner, "|", 2)
		target := strings.TrimSpace(parts[len(parts)-1])
		if target != "" {
			out = append(out, target)
		}
	}
	return out
}
