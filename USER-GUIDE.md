# Eternalgy Case Hub — User Guide

**For Eternalgy admin and case management staff**

---

## What this app is

Case Hub replaces manual tracking of solar installation cases — customer
details, package specs, payment progress, SEDA, TNB, installation status,
O&M, insurance, cancellations, referrals and delivery — all in one place.

It installs like a normal Windows program. There is no website to log into
and no link to remember.

Unlike some of our other apps, **there is nothing to set up on first
launch.** It comes preconfigured and connects automatically — you just open
it and start working.

---

## Before you start

You need:

- A Windows PC (Windows 10 or 11)
- An internet connection (the app has no offline mode — everything lives
  in the cloud)
- About 5 minutes

---

## Step 1 — Download

Go to the **[Case Hub download page](https://github.com/NurulAqilahSaifulBahril/CRM/releases/latest)**.

Scroll down to the **Assets** list and click the file that starts with
`Case-Hub-Setup` and ends in `.exe`. There will be a version number in the
middle — always take the newest one the page offers.

It will go to your **Downloads** folder unless you choose somewhere else.

---

## Step 2 — Install

Double-click the file you just downloaded.

> ### ⚠️ You will see a blue warning screen. This is normal.
>
> Windows shows **"Windows protected your PC"** because this is an internal
> company app and not something sold in a shop. It does not mean the file
> is unsafe.
>
> Click **More info**, then click **Run anyway**.
>
> If you do not see "Run anyway", make sure you clicked **More info** first.

Click **Next** through the screens, tick **Create a desktop shortcut** if
you would like one, then click **Install**.

When it is done you will have an **Eternalgy Case Hub** shortcut on your
desktop and in the Start Menu.

---

## Step 3 — Open it

Double-click the desktop shortcut.

The first time you open it, the window may stay blank for a few seconds
while it starts up. This is normal and only happens on the first launch.

You should then see the **Dashboard** directly — no login screen, no setup
box. The app is already connected.

---

## Signing in to make changes

You can look around — the Dashboard, case list, and reports — without
signing in.

The moment you try to **add or edit a case**, a **Staff Login** box appears
asking for your name and password. This is not a security wall so much as
an accountability record: every change is saved against the person who made
it.

- Pick your name from the list and enter your password.
- If your name is not in the list, someone with access to **员工管理 Staff
  Accounts** needs to add you first.
- You only need to sign in once per session — it does not ask again until
  you close and reopen the app.

---

## Finding your way around

The sidebar on the left has these sections:

| Section | What it's for |
|---|---|
| **数据总览 Dashboard** | Totals for the selected date range, plus the Report Center |
| **Admin 总部** | The main case list — search, open, add and edit cases |
| **Agent 视角（模拟链接）** | Preview of what an agent sees through their shared link |
| **所有 Case All Cases** | Every case, unfiltered |
| **等待安装 Awaiting Install** | Cases that are paid and ready to schedule for installation |
| **出货批次 Shipment Batches** | Group cases into a shipment batch and track delivery by item |
| **Agent 管理** | Add, edit and remove agents |
| **货物管理 Items** | Inventory: panels, inverters, batteries, EV chargers, cap banks, other goods |
| **员工管理 Staff Accounts** | Add or remove staff logins used for the accountability check above |

### Report Center

On the Dashboard, pick a date range and click a report button — it renders
below, ready to **print or save as PDF**. Reports available:

- Deposit / Payment Progress, Agent Full Case List
- Deposit Report, 60%+ Paid, 80%+ Paid (commission threshold), Full Payment
- Pending Letter of Offer
- SEDA Application Report, Pending SEDA Submission
- TNB Application Report, Pending TNB Application
- Install Report, Installed but Not Fully Paid, Install Queue
- Shipment Report, O&M Report, Property Type Summary
- Cancellation Report
- Document Log (every Quotation / Invoice generated, and by whom)

You can also filter the whole Report Center down to one agent, for a
boss-wants-to-see-one-agent's-numbers report.

---

## Working with colleagues

Case Hub is shared — the moment you or a colleague saves something,
**everyone else sees it immediately**, with no refresh needed. If two of
you have a case open at once, you are both looking at the same record.

---

## Updating

**You do not need to do anything — there is no update button.** The app
checks for new versions by itself in the background, downloads quietly if
one is found, and installs it automatically the next time you close and
reopen the app. You will not see a progress bar or be asked to confirm
anything.

- **Nothing of yours is lost.** Your data lives in the shared cloud
  database, not on your PC, so an update never touches it.
- **You never download the installer again.** Steps 1–2 above are one time
  only.
- **To check your version:** Settings → Apps → Eternalgy Case Hub. The app
  itself does not show a version number on screen.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Blue "Windows protected your PC" screen | Normal for an internal app | Click **More info** → **Run anyway** |
| Window is blank for a few seconds | Normal on first launch | Wait 10 seconds. If still blank, close it completely and reopen |
| **"保存失败 Save failed"** message | The change did **not** save — this is serious | Check your internet connection and try saving again. Do not assume it went through |
| **"Postgres 同步失败" / "Postgres sync failed"** message | Your change **was** saved in Case Hub. A separate background copy failed to sync | No need to redo anything. Just let Nurul / IT know so it can be checked |
| Login box won't accept your name/password | Your account may not exist yet, or the password changed | Ask whoever manages **员工管理 Staff Accounts** to check |
| App will not start at all | — | Restart your PC, then try again |
| Anything else | — | Contact Nurul. Say what you were doing and what you saw |

**Please report problems rather than working around them** — especially the
two message types above, since they look similar but mean very different
things.

---

## For the app administrator

*(This section is for whoever manages the database connection — most staff
can skip it.)*

The database credentials the app uses are stored in a small settings file,
separate from the program itself, so they survive every update. To view or
update them:

1. Open the app.
2. **File → Open Settings Folder** in the menu bar.
3. Edit the `.env.local` file there in Notepad.
4. Save. The change applies immediately — no restart needed.

---

## Things to know

- **Your work is not stored on your PC.** All case data lives in the cloud,
  so there is nothing to back up and nothing lost if your PC is replaced.
- **To uninstall:** Settings → Apps → Eternalgy Case Hub → Uninstall.

---

## Who to contact

**Nurul** — for anything about the app: problems, questions, or suggestions
for what would make it easier to use.
