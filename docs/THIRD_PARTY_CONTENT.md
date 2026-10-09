# Third-party evaluation content

Wikipedia article text reproduced in evaluation reports and browser fixtures is by the respective Wikipedia contributors and is licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/legalcode). This includes modified/extracted versions of that text. The project Apache-2.0 license does not replace this license for those excerpts.

| Article / attribution | Contributor history | Files containing excerpts |
| --- | --- | --- |
| [Apple Inc.](https://en.wikipedia.org/wiki/Apple_Inc.) ([source revision 1378679226](https://en.wikipedia.org/w/index.php?title=Apple_Inc.&oldid=1378679226)) | [History](https://en.wikipedia.org/w/index.php?title=Apple_Inc.&action=history) | `tests/fixtures/apple-wikipedia.html`, `docs/apple-gpu-validation.json`; fixture used by `tests/browser/search.spec.ts` and `tests/browser/reranker.spec.ts` |

Changes: webpage text was extracted into passages, stripped of markup, sometimes stripped of reference markers, shortened or combined, and embedded in JSON reports or test HTML. Ranking scores and surrounding test/report code are original project work. The pinned fixture source revision and contributor history are linked above. No Wikipedia images are redistributed. These evaluation files and fixtures are excluded from the Chrome store ZIP.

Future evaluations that save external page text must record its source, applicable license, attribution and modifications. A page being publicly accessible does not by itself grant redistribution rights. See [Wikimedia reuse requirements](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content).

Active Wikipedia browser tests use only Apple Inc. The offline snapshot retains article paragraphs and section headings; links, tables, images, navigation and reference lists were omitted, and numeric citation markers were removed. Retrieved October 9, 2026.
