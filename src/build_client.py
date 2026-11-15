#!/usr/bin/env python3
"""Assemble the installable bundle's client.js from client.src.js + quotes.json.

The Client module must be one browser-ready factory script (no ESM import, no
build step in the profile), so the quote table is injected as a JSON literal and
the source is checked for the contract markers the Host relies on.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, 'src', 'client.src.js')
# The pool lives beside this script, so the repository is self-contained: the
# published bundle and the data it was built from sit in one tree.
DATA = os.path.join(HERE, 'src', 'quotes.compact.json')
OUT = os.path.join(HERE, 'client.js')


def main():
    source = open(SRC, encoding='utf-8').read()
    quotes = json.load(open(DATA, encoding='utf-8'))

    if 'RAW_QUOTES' not in source:
        sys.exit('client.src.js must contain the RAW_QUOTES placeholder')
    if re.search(r'^\s*(import|export)\s', source, re.M):
        sys.exit('client.js must not contain ESM import/export statements')

    literal = json.dumps(quotes, ensure_ascii=False, separators=(',', ':'))
    out = source.replace('RAW_QUOTES', literal)
    open(OUT, 'w', encoding='utf-8').write(out)
    print(f'wrote {OUT} ({os.path.getsize(OUT)} bytes, {len(quotes)} quotes)')


if __name__ == '__main__':
    main()
