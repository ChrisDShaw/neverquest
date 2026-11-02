// Small, editable offline starter collection. These are factual summaries, not copied walkthroughs.
// Sources checked 2026-11-01; reference data may change independently of the game ledger.
const teethSource = 'https://monstersandmemories.wiki/quests/beastmaster-starter-quest-night-harbor';
export const starterKnowledge = [
  { item: 'Bone Chips', quests: 'Bone Chips for Squire Ryland (Night Harbor); Bone Chips for Moon Dances (Faelindral).',
    recipes: '', notes: 'Notes checked 2026-11-01. Ask the quest NPC to confirm the turn-in details.', source: 'https://monstersandmemories.wiki/quests' },
  ...['Rat Tooth', 'Bat Tooth', 'Jackal Tooth'].map(item => ({ item,
    quests: 'Beastmaster Starter Quest (Night Harbor), for Leila Ghasem.',
    recipes: 'Betoothed Leather Cord: combine two Rat Teeth, two Bat Teeth and two Jackal Teeth in the Worn Leather Cord.',
    notes: 'Notes checked 2026-11-01. This combine is part of the quest. Other tradeskill recipes aren’t listed here.', source: teethSource }))
];
