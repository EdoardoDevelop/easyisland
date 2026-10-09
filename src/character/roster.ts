// The characters offered in Impostazioni → Aspetto, in this order; the first
// is the default. A new character: write its file (see character.ts) and add
// it here.

import { registerCharacters } from "./character";
import { CUBE } from "./cube";
import { DROP } from "./drop";
import { SLIME } from "./slime";

registerCharacters(DROP, SLIME, CUBE);
