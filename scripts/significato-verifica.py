"""Checks meaning_local.rs against the original tokenizer and model.

Writes «text<TAB>ids<TAB>vector» lines for the Rust test `tokens_like_the_original`:

    python scripts/significato-verifica.py <folder with tokenizer.json and model.safetensors> <out.tsv> [more.txt]

Needs `tokenizers`, `safetensors` and `numpy` (pip). `more.txt`: extra sentences, one per line.
Then, in src-tauri:

    EI_MEANING_DIR=<model files> EI_TOKENS=<out.tsv> cargo test -p easyisland --lib tokens_like_the_original -- --ignored --nocapture
"""
import sys

import numpy as np
from safetensors.numpy import load_file
from tokenizers import Tokenizer

SENTENCES = [
    "Il computer dell'ufficio non si accende",
    "Il PC della segreteria è spento",
    "Previsioni del tempo per domani",
    "il NAS del cliente Rossi",
    "server di Rossi",
    "fattura di ottobre: 1.234,56 € (IVA 22%)",
    "invoice for October",
    "Perché l'email non arriva? È già la terza volta!!!",
    "  spazi   doppi\tcon tab\ne a capo  ",
    "caffè, città, più, perché, Ä Ö Ü ß, ñ, ç",
    "e\u0301 combinato, fi legatura, ＡＢＣ larghi, ①②, ½",
    "emoji 😀👍🏽 e simboli ™ © ® → ✓",
    "https://example.com/path?a=1&b=2#x",
    "C:\\Users\\nome\\Documents\\file_nuovo-v2.docx",
    "user@example.com @nome #tag ~/cartella",
    "Switch Ubiquiti USW-24-PoE, VLAN 10 e 20",
    "日本語のテキストと中文",
    "Привет, как дела?",
    "مرحبا بالعالم",
    "x",
    "",
    "   ",
    "[PAD] [UNK] <s> </s>",
    "1234567890 3,14 1e10 0x1F",
    "riunione con il cliente lunedì alle 9:30",
    "ricordami di chiamare Rossi domani",
    "il backup notturno è fallito sul server di Bianchi",
    "stampante HP in rete non stampa dal Wi-Fi",
]


def escape(s):
    return s.replace("\\", "\\\\").replace("\n", "\\n").replace("\t", "\\t")


def main():
    folder, out = sys.argv[1], sys.argv[2]
    sentences = list(SENTENCES)
    if len(sys.argv) > 3:
        with open(sys.argv[3], encoding="utf-8") as f:
            sentences += [l.rstrip("\n") for l in f if l.strip()]
    tok = Tokenizer.from_file(f"{folder}/tokenizer.json")
    unk = tok.token_to_id("[UNK]")
    emb = next(iter(load_file(f"{folder}/model.safetensors").values()))
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        for s in sentences:
            ids = [i for i in tok.encode(s, add_special_tokens=False).ids if i != unk][:512]
            vec = ""
            ids_in = [i for i in ids if i < emb.shape[0]]
            if ids_in:
                v = emb[ids_in].mean(axis=0)
                n = np.linalg.norm(v)
                if n > 0:
                    v = v / n
                vec = " ".join(f"{x:.6f}" for x in v)
            f.write(f"{escape(s)}\t{' '.join(map(str, ids))}\t{vec}\n")
    print(f"{len(sentences)} frasi in {out}; matrice {emb.shape}")


if __name__ == "__main__":
    main()
