import express from "express";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks = [
  "Ace", "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "Jack", "Queen", "King"
];

let decks = {};

function createDeck(shuffle = false) {
  let cards = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      cards.push({ suit, rank });
    }
  }
  if (shuffle) {
    cards = cards.sort(() => Math.random() - 0.5);
  }
  return cards;
}

app.post("/decks", (req, res) => {
  const { shuffle = false } = req.body;
  const id = uuidv4();
  decks[id] = { id, cards: createDeck(shuffle), drawn: [] };
  res.status(201).json({ deckId: id, remaining: decks[id].cards.length });
});

app.get("/decks/:id", (req, res) => {
  const deck = decks[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  res.json({ deckId: deck.id, remaining: deck.cards.length, drawn: deck.drawn.length });
});

app.post("/decks/:id/draw", (req, res) => {
  const { count = 1 } = req.body;
  const deck = decks[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  if (count > deck.cards.length) return res.status(400).json({ error: "Not enough cards remaining" });
  const drawnCards = deck.cards.splice(0, count);
  deck.drawn.push(...drawnCards);
  res.json({ drawn: drawnCards, remaining: deck.cards.length });
});

app.post("/decks/:id/shuffle", (req, res) => {
  const deck = decks[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  deck.cards = deck.cards.sort(() => Math.random() - 0.5);
  res.json({ message: "Deck shuffled", remaining: deck.cards.length });
});

app.delete("/decks/:id", (req, res) => {
  if (!decks[req.params.id]) return res.status(404).json({ error: "Deck not found" });
  delete decks[req.params.id];
  res.json({ message: "Deck deleted" });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Playing Card API running on http://localhost:${PORT}`);
});
