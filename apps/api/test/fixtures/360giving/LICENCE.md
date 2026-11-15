# 360Giving Data Standard schema (bundled copy)

These two files are copies of the 360Giving Data Standard JSON schemas, version 1.4.3:

| File | Source |
| --- | --- |
| `360-giving-schema.json` | https://raw.githubusercontent.com/ThreeSixtyGiving/standard/main/schema/360-giving-schema.json |
| `360-giving-package-schema.json` | https://raw.githubusercontent.com/ThreeSixtyGiving/standard/main/schema/360-giving-package-schema.json |

Fetched on 2026-11-15. The files on the `main` branch are the files of the `1.4.3` tag with the
`$id` corrected to `.../1.4.3/...` (the tagged files still name `1.4.2` in their `$id`); nothing
else differs. SHA-256:

- `360-giving-schema.json`: `e8a1c581ce18447b2dc9c757d7229862624970a3724718d8319a8d3c47429ebb`
- `360-giving-package-schema.json`: `30c0897090628d161cda0f3048031abd955eb9b68cfd83f8fe54340756886b11`

They are used only by the tests (`apps/api/test/open-data.test.ts`), to check that the GMS's
360Giving export is valid. The GMS never fetches them at run time.

## Licence

The 360Giving Data Standard, including these schemas, is published by 360Giving
(https://www.360giving.org) under the Creative Commons Attribution 4.0 International Licence
(CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), as stated in the standard's
repository (`LICENSE.md` at https://github.com/ThreeSixtyGiving/standard). The licence does not
apply to the 360Giving theme and related assets such as the logo, which are not copied here.

Attribution: "360Giving Data Standard schema, version 1.4.3, by 360Giving, licensed under
CC BY 4.0." The files are unchanged.
