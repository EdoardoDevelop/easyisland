// The characters offered in Impostazioni → Aspetto, in this order; the first
// stands in for an unknown id (the default for a new install is Jarvis Sfera,
// settings). A new character: write its file (see character.ts) and add
// it here.

import { MAGMA, PIETRA, ROCCIA } from "./blobs";
import { registerCharacters } from "./character";
import { CUBE } from "./cube";
import { DROP } from "./drop";
import { FLAME } from "./flame";
import { GECKO } from "./gecko";
import { JARVIS, JARVIS_PLASMA, JARVIS_SPHERE } from "./jarvis";
import { FOGLIA } from "./leaf";
import { SLIME } from "./slime";

registerCharacters(DROP, SLIME, CUBE, GECKO, FLAME, MAGMA, PIETRA, ROCCIA, FOGLIA, JARVIS, JARVIS_SPHERE, JARVIS_PLASMA);
