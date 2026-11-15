#!/usr/bin/env python3
"""Validate an agent-produced Weave candidate bundle and optionally its target IDs.

This validates structure and reference integrity, not research truth or consent.
"""
import argparse
import json
from pathlib import Path
import sys
from jsonschema import Draft202012Validator


def validate(candidate_file: Path, schema_file: Path, workspace_file: Path | None):
    data = json.loads(candidate_file.read_text(encoding='utf-8'))
    schema = json.loads(schema_file.read_text(encoding='utf-8'))
    errors = [f'{"/".join(str(x) for x in e.path) or "root"}: {e.message}' for e in Draft202012Validator(schema).iter_errors(data)]
    if workspace_file and not errors:
        ws = json.loads(workspace_file.read_text(encoding='utf-8'))
        model = ws.get('base', ws)
        nodes = {x['id'] for x in model.get('nodes', [])}
        targets = nodes | {x['id'] for x in model.get('edges', [])} | {x['id'] for x in model.get('activities', [])}
        for index,c in enumerate(data['candidates']):
            if c['kind']=='note' and c.get('targetId') and c['targetId'] not in targets:
                errors.append(f'candidate {index}: targetId {c["targetId"]!r} does not exist')
            if c['kind']=='activity' and c['ownerId'] not in nodes:
                errors.append(f'candidate {index}: ownerId {c["ownerId"]!r} does not exist')
            if c['kind']=='relationship':
                for prop in ('fromId','toId'):
                    if c[prop] not in nodes: errors.append(f'candidate {index}: {prop} {c[prop]!r} does not exist')
                if c['fromId']==c['toId']:errors.append(f'candidate {index}: same source and destination')
                if c.get('performerId') and c['performerId'] not in nodes: errors.append(f'candidate {index}: performerId {c["performerId"]!r} does not exist')
    if not errors:
        print(f'VALID: {len(data["candidates"])} human-review candidates. This does not verify factual accuracy.')
    else:
        for msg in errors:print('INVALID:',msg)
    return not errors

if __name__=='__main__':
    pa=argparse.ArgumentParser()
    pa.add_argument('file',type=Path)
    pa.add_argument('--workspace',type=Path)
    args=pa.parse_args()
    schema=Path(__file__).resolve().parents[1]/'schema.json'
    try:ok=validate(args.file,schema,args.workspace)
    except (OSError,ValueError) as exc:
        print('INVALID:',exc);ok=False
    sys.exit(0 if ok else 1)
