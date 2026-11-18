export interface SceneEntry {
  id: string;
  start: number;
  end: number;
  duration: number;
  voText: string;
  subtitle: string[];
}

const raw = [
  {
    id: "s01_hook",
    duration: 8,
    voText:
      "Dreißig Tage. Was passiert, wenn eine Fünfzehn-Kilotonnen-Detonation eine deutsche Stadt trifft?",
    subtitle: [
      "30 Tage.",
      "Was passiert bei einer",
      "15-Kilotonnen-Detonation?",
    ],
  },
  {
    id: "s02_blast",
    duration: 23,
    voText:
      "Tag Null. Ein Lichtblitz. Die Druckwelle breitet sich mit Überschallgeschwindigkeit aus. Fensterscheiben brechen im Umkreis von etwa fünf Kilometern. Suchen Sie sofort Schutz im Inneren.",
    subtitle: [
      "Tag Null — Der Lichtblitz.",
      "Druckwelle mit Überschall.",
      "Fenster brechen bei etwa 5 km.",
      "Sofort Schutz im Inneren suchen.",
    ],
  },
  {
    id: "s03_dust",
    duration: 20,
    voText:
      "Stunde Eins. Staub verdunkelt die Straßen. M. tastet sich in den Keller. Ein innenliegender Raum oder Keller bietet den besten Schutz vor Trümmern und Strahlung.",
    subtitle: [
      "Stunde 1 — Staub und Dunkelheit.",
      "Keller oder innenliegender Raum.",
      "Bester Schutz vor Trümmern.",
    ],
  },
  {
    id: "s04_fire",
    duration: 20,
    voText:
      "Tag Eins bis Drei. Die Karte zeigt die Zerstörungsringe. Etwa ein Komma sechs Kilometer schwere Gebäudeschäden. Etwa vier Komma fünf Kilometer Splittergefahr durch Glas. Daten basieren auf NUKEMAP-Schätzungen.",
    subtitle: [
      "Tag 1–3 — Zerstörungsringe.",
      "ca. 1,6 km: schwere Schäden",
      "ca. 4,5 km: Splittergefahr",
      "Quelle: NUKEMAP (Schätzung)",
    ],
  },
  {
    id: "s05_water",
    duration: 25,
    voText:
      "Woche Eins. Die Infrastruktur ist ausgefallen. Kein Strom, kein fließendes Wasser. M. verteilt Vorräte. Zehn Tage einplanen. Etwa zwei Liter Wasser pro Person und Tag. Batterie-Radio, Taschenlampe, Dokumente, Bargeld. Empfehlung des BBK.",
    subtitle: [
      "Woche 1 — Vorräte sichern.",
      "10 Tage, 2 L Wasser/Tag/Person",
      "Radio, Taschenlampe, Bargeld",
      "Empfehlung: BBK-Notfallvorsorge",
    ],
  },
  {
    id: "s06_plume",
    duration: 25,
    voText:
      "Woche Zwei bis Drei. Eine radioaktive Wolke zieht mit dem Wind. Bleiben Sie im Gebäude. Informieren Sie sich über Cell Broadcast, die NINA-App oder Batterie-Radio. Meiden Sie das Freie so lange wie möglich.",
    subtitle: [
      "Woche 2–3 — Radioaktive Wolke.",
      "Im Gebäude bleiben.",
      "NINA-App, Cell Broadcast, Radio.",
      "Freie meiden.",
    ],
  },
  {
    id: "s07_day30",
    duration: 20,
    voText:
      "Tag Dreißig. Erste Schritte zurück nach draußen. Organisierte Nachbarschaftshilfe. M. hängt eine Liste an die Gemeindetafel. Gemeinsam ist der Wiederaufbau möglich.",
    subtitle: [
      "Tag 30 — Erste Schritte.",
      "Nachbarschaft organisieren.",
      "Wiederaufbau beginnt.",
    ],
  },
  {
    id: "s08_outro",
    duration: 10,
    voText:
      "Vorbereitung rettet Leben. Informieren Sie sich beim BBK. Bleiben Sie ruhig. Bleiben Sie vorbereitet.",
    subtitle: [
      "Vorbereitung rettet Leben.",
      "bbk.bund.de",
      "Bleiben Sie vorbereitet.",
    ],
  },
];

// build cumulative start/end
let cursor = 0;
export const scenes: SceneEntry[] = raw.map((r) => {
  const entry: SceneEntry = {
    id: r.id,
    start: cursor,
    end: cursor + r.duration,
    duration: r.duration,
    voText: r.voText,
    subtitle: r.subtitle,
  };
  cursor += r.duration;
  return entry;
});

export const TOTAL_DURATION = cursor; // 155
