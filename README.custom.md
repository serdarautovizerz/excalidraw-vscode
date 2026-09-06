# Fork maintenance (`custom` branch)

This is `serdarautovizerz/excalidraw-vscode`, a fork of
[excalidraw/excalidraw-vscode](https://github.com/excalidraw/excalidraw-vscode).
All local work lives on the **`custom`** branch (currently ~16 commits ahead
of `master`).

## Rules

- **Never commit to `master`** — it tracks upstream and exists only to receive
  upstream updates.
- `custom` is the only writable branch; it is pushed to `origin/custom`.

## Getting updates from upstream

This fork updates by **merge**, not rebase: `custom` carries a real commit
history and is checked out on more than one machine, so rewriting it would
force-push every machine out of sync. Merging keeps history append-only.

```sh
git fetch -q upstream
git checkout master
git merge -q --ff-only upstream/master   # keep master an exact mirror
git push -q origin master

git checkout custom
git merge master                         # bring the update into custom
# resolve conflicts if any, then:
git push -q origin custom
```

If `--ff-only` fails on master, upstream rewrote history — stop and look
before doing anything else.

(If the fork's diff ever shrinks to one or two commits, switching to the
rebase-onto-upstream model used by the `opencode` fork — see its
`README.custom.md` — gives a cleaner patch; with the current history, merge
is the calmer choice.)
