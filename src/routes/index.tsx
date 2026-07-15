import { createFileRoute } from "@tanstack/react-router";
import FruitSlashFrenzy from "@/game/FruitSlashFrenzy";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <FruitSlashFrenzy />;
}