
import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

type Suit = "Hearts" | "Diamonds" | "Clubs" | "Spades";
type Rank =
  | "Ace" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "Jack" | "Queen" | "King";

interface Card {
  suit: Suit;
  rank: Rank;
}

interface Deck {
  id: string;
  cards: Card[];
  drawn: Card[];
}

const suits: Suit[] = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks: Rank[] = [
  "Ace", "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "Jack", "Queen", "King"
];
const decks: Record<string, Deck> = {};

function createDeck(shuffle = false): Card[] {
  let cards: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      cards.push({ suit, rank });
    }
  }
  if (shuffle) cards = cards.sort(() => Math.random() - 0.5);
  return cards;
}

const app = express();
app.use(express.json());

app.post("/decks", (req: Request, res: Response) => {
  const { shuffle = false } = req.body as { shuffle?: boolean };
  const id = uuidv4();
  decks[id] = { id, cards: createDeck(shuffle), drawn: [] };
  res.status(201).json({ deckId: id, remaining: decks[id].cards.length });
});

app.get("/decks/:id", (req: Request, res: Response) => {
  const deck = decks[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  res.json({ deckId: deck.id, remaining: deck.cards.length, drawn: deck.drawn.length });
});

app.post("/decks/:id/draw", (req: Request, res: Response) => {
  const { count = 1 } = req.body as { count?: number };
  const deck = decks[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  if (count > deck.cards.length) return res.status(400).json({ error: "Not enough cards remaining" });

  const drawnCards = deck.cards.splice(0, count);
  deck.drawn.push(...drawnCards);
  res.json({ drawn: drawnCards, remaining: deck.cards.length });
});

app.post("/decks/:id/shuffle", (req: Request, res: Response) => {
  const deck = decks[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  deck.cards = deck.cards.sort(() => Math.random() - 0.5);
  res.json({ message: "Deck shuffled", remaining: deck.cards.length });
});

app.delete("/decks/:id", (req: Request, res: Response) => {
  if (!decks[req.params.id]) return res.status(404).json({ error: "Deck not found" });
  delete decks[req.params.id];
  res.json({ message: "Deck deleted" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎴 Playing Card API running at http://localhost:${PORT}`);
});
