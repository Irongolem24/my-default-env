# Third-party notices

my-default-env contains no code copied from the projects below. Their designs were studied
(see `docs/research/`) and the following ideas were reimplemented from scratch:

| Project | License | Ideas reimplemented |
|---|---|---|
| [claude-mem](https://github.com/thedotmack/claude-mem) | Apache-2.0 | hook event set and IO discipline (exit 0, single stdout JSON), field truncation (head/tail with marker), base64 image extraction, secret-pattern redaction, capped SessionStart context |
| [Graphiti](https://github.com/getzep/graphiti) | Apache-2.0 | bi-temporal fact model (`valid_from`/`valid_until`/`recorded`/`superseded_at`), deterministic supersession by validity date, contradiction rules used in the curate skill (paraphrased) |
| [Beads](https://github.com/steveyegge/beads) | MIT | short hash ids, `derived_from`/`depends_on` chains, capped context injection, session-close checklist |
| [Basic Memory](https://github.com/basicmachines-co/basic-memory) | AGPL-3.0 | **format compatibility only** (frontmatter keys, permalinks, `[[wikilinks]]`, `bm_parse_semantics`). No code or text copied. |
| [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | MIT | stdin reader with timeout, Stop-hook loop guard |
