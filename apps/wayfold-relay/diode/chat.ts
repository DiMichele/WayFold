import { el } from "./common.ts";

export interface ChatLine {
  text: string;
  at: number;
}

export function renderChat(listId: string, emptyId: string, lines: readonly ChatLine[]): void {
  const list = el(listId);
  const empty = el(emptyId);
  if (!list) return;
  if (empty) empty.hidden = lines.length > 0;
  const time = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { timeStyle: "medium" });
  list.replaceChildren(
    ...lines.map((line, index) => {
      const li = document.createElement("li");
      if (index === lines.length - 1) li.className = "is-new";
      const stamp = document.createElement("time");
      stamp.dateTime = new Date(line.at).toISOString();
      stamp.textContent = time.format(line.at);
      const body = document.createElement("span");
      body.textContent = line.text;
      li.append(stamp, body);
      return li;
    }),
  );
  list.scrollTop = list.scrollHeight;
}
