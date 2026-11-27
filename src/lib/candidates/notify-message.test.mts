import test from "node:test";
import assert from "node:assert/strict";

import { ageLabel, candidateNotifyMessage } from "./notify-message.ts";

const url = "https://sheerly.app/people/candidates/a414d4c1";

test("возраст склоняется", () => {
  assert.equal(ageLabel(21), "21 год");
  assert.equal(ageLabel(23), "23 года");
  assert.equal(ageLabel(25), "25 лет");
  assert.equal(ageLabel(11), "11 лет");
  assert.equal(ageLabel(114), "114 лет");
});

test("ФИО ведёт на анкету, ниже должность с возрастом и контакты", () => {
  assert.equal(
    candidateNotifyMessage(
      {
        full_name: "Дурнев Павел Витальевич",
        desired_position: "Бармен",
        age: 24,
        phone: "+7 999 123-45-67",
        social: {
          instagram: "https://www.instagram.com/durnev?igsh=abc",
          telegram: "@durnev_p",
          vk: "durnev",
        },
      },
      url,
    ),
    [
      "📝 <b>Новая анкета</b>",
      [
        `<a href="${url}"><b>Дурнев Павел Витальевич</b></a>`,
        "Бармен · 24 года",
        "📞 +7 999 123-45-67",
        '📷 <a href="https://www.instagram.com/durnev?igsh=abc">@durnev</a>',
        '✈️ <a href="https://t.me/durnev_p">@durnev_p</a>',
      ].join("\n"),
    ].join("\n\n"),
  );
});

test("пустые контакты не выводятся, текст экранируется", () => {
  const text = candidateNotifyMessage(
    { full_name: "Анна <Smith>", desired_position: null, age: null, phone: " ", social: { instagram: "" } },
    url,
  );
  assert.equal(
    text,
    `📝 <b>Новая анкета</b>\n\n<a href="${url}"><b>Анна &lt;Smith&gt;</b></a>\nДолжность не указана`,
  );
});

test("соцсеть без ссылки — подписью", () => {
  const text = candidateNotifyMessage(
    { full_name: "Анна", desired_position: "Бармен", age: null, phone: null, social: { telegram: "есть, напишу" } },
    url,
  );
  assert.match(text, /\n✈️ есть, напишу$/);
});
