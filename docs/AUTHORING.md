# Authoring guide — building a course

A plain-language how-to for staff. It covers everything you need to build and maintain a course:
create the course, group it into phases, add sessions, tag the special sessions, attach materials
(text, files, links), publish it, and give learners access. No technical knowledge required.

> **Who can do this?** Only an **Admin** can create or edit course content. Tutors, managers and
> learners cannot — they will not see the authoring buttons, and the system blocks them even if they
> try. So make sure you are signed in with an Admin account.

**Words we use:**
- **Course** — the whole programme (e.g. a diploma).
- **Phase** — a chapter/grouping of sessions inside a course.
- **Session** (also called a "unit" or "lesson") — one teaching item inside a phase.
- **Material** — the content attached to a session: rich text, a file, or a link.
- **Type label** — an optional tag on a session (Induction, ID check, Session, Portfolio review).
- **Draft / Published** — a Draft course is hidden from learners; a Published one is visible to
  enrolled learners.

---

## 1. Create the course

1. Go to **Courses** in the left menu.
2. Click **New course** (or the **+** / "Create" button).
3. Pick the course **type** if asked (for a self-study programme choose the self-paced option).
4. Enter the **Title** — use the full programme name, e.g.
   *iCQ Level 5 Diploma — Leading and Managing an Adult Care Service (England)*.
5. Enter the **Description**. Put the **qualification reference here** (e.g. `610/7280/1`) along with a
   short summary, so it is recorded on the course.
6. Save. You are taken into the new course. **It starts as a Draft** (hidden from learners) — that is
   what you want while you build it.

You can reopen these fields any time from the course's **Settings** page.

---

## 2. Add the phases (chapters)

Phases group your sessions. Turn grouping on if it isn't already:

1. Open the course and go to the **Lessons** area.
2. If you see a flat list with no chapters, open **Settings** and switch on **content grouping**
   (this lets you use phases). Most courses have it on by default.
3. Back in **Lessons**, click **Add content → add a phase/section** and give it a name
   (e.g. *Phase 1 — Induction*).
4. Repeat for every phase (a typical diploma has around eight).

**Tip:** create your phases first, in order, before adding sessions — it's easier to drop each
session straight into the right phase.

---

## 3. Add the sessions (in order)

1. In **Lessons**, click **Add content → add a session** (a lesson).
2. Type the **session title** and choose the **phase** it belongs to.
3. Save. The session appears under its phase.
4. Repeat for every session, **top to bottom in teaching order**.

**Getting the order right.** New sessions are added to the end of their phase. To rearrange:
1. Click **Start reorder**.
2. **Drag** sessions up/down within a phase, or drag one into a different phase.
3. Click **End reorder** to save. The system automatically re-numbers them cleanly (no gaps or
   duplicates) — you don't manage the numbers yourself.

---

## 4. Tag the special sessions (type labels)

Some sessions carry a **type label**. The four valid labels are: **Induction**, **ID check**,
**Session**, **Portfolio review**. Most sessions have **no label** (leave it blank) — labels are only
for the special ones (e.g. the first induction session, an ID-check session, the final portfolio
review). These labels matter for a later feature (they'll be exempt from step-by-step unlocking), so
set them correctly now.

To set a label:
1. Open the session and switch it to **edit** mode.
2. Go to the **Settings** tab.
3. Under **Unit type**, pick the label from the dropdown — or choose **No type** to clear it.
4. It saves automatically.

---

## 5. Attach materials to a session

Open a session and switch to **edit** mode. There are three kinds of material:

**A) Rich text** (notes, instructions, tables, images) — the **Note** tab.
- Type or paste your content into the editor. Use the toolbar for headings, lists, links, images,
  tables, etc. It saves as you go.

**B) Files** (PDFs, Word docs) — the **Document** tab.
- Click **Add document**, choose the file, and it uploads. It appears in the attachments list.
- Allowed file types: **PDF, Word (.doc/.docx)**. Max size is a few MB per file (ask an admin if you
  need it raised).
- To remove one, use its delete (bin) button. To replace a file, delete it and add the new one.

**C) Links** (a page on another website) — also the **Document** tab, **Links** section.
- Under **Links**, enter a **Label** (what the learner sees, e.g. *Awarding body handbook*) and the
  **URL** (the web address), then click **Add link**.
- Remove a link with its bin button.

> **Placeholders:** if you don't have the final material yet, add a clearly-marked placeholder (e.g.
> type "PLACEHOLDER — final handout to follow" in the Note) so it's obvious it isn't finished.

Files and text are stored **privately** and are shown **only** to enrolled learners of a published
course — there is no public link. Links point to wherever their URL goes (they're external).

---

## 6. Publish the course

While a course is **Draft**, learners can't see it. When it's ready:

1. Open the course's **Settings**.
2. Switch **Published** on.

To take it back offline, switch **Published** off again — it becomes a Draft and disappears from
learners immediately.

---

## 7. Give learners access (enrolment)

A learner only sees a course they're **enrolled** in — and only once it's **published**. A learner in
one course can never see another course's content.

To enrol someone:
1. Open the course and go to **People** (the roster).
2. Add the learner to the course. (Only Admins can do this.)

They can then sign in and open the course. For now enrolment is done here by an admin; automatic
"buy a course → get enrolled" checkout is a later addition.

---

## 8. What a learner sees

An enrolled learner opens the course and works through the sessions in order. Each session shows its
materials: rich text on screen, files they can open/download, and links they can click. Right now
**all** sessions are visible (they can jump ahead) — step-by-step unlocking (finish one before the
next opens) is a planned addition and isn't switched on yet.

---

## Quick checklist for a new course

- [ ] Course created, title + description (with the qualification ref) filled in
- [ ] Phases created, in order
- [ ] Sessions created, in order, each in the right phase
- [ ] Special sessions tagged (Induction / ID check / Portfolio review)
- [ ] Session materials attached (text / files / links), placeholders clearly marked
- [ ] Reviewed the order (Start reorder → drag → End reorder)
- [ ] Published when ready
- [ ] Learners enrolled

---

## Troubleshooting

- **I don't see the Add/Edit buttons.** You're probably not signed in as an Admin. Only Admins author.
- **A learner says the course isn't there.** Check it's **Published** and that they're **enrolled**.
- **My file won't upload.** Check it's a PDF or Word file and within the size limit.
- **The order looks wrong.** Use **Start reorder**, drag, then **End reorder** — the system tidies the
  numbering for you.
