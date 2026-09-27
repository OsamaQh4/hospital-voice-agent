"""Structural checks for docs/conversation-flow.json (the live Portal flow,
exported from GET /v2/ai/assistants/<id> -> conversation_flow).

Run after any change to the flow:  python3 docs/validate_flow.py
"""
import json
import os
import sys
from collections import defaultdict

FLOW_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "conversation-flow.json")

with open(FLOW_PATH, encoding="utf-8") as f:
    flow = json.load(f)

nodes = {n["id"]: n for n in flow["nodes"]}
edges = flow["edges"]
errors = []

if flow["start_node_id"] not in nodes:
    errors.append(f"start_node_id {flow['start_node_id']!r} is not a node")

outgoing = defaultdict(list)
for e in edges:
    if e["start_node_id"] not in nodes:
        errors.append(f"edge {e['id']}: unknown start node {e['start_node_id']!r}")
    if e["target"]["node_id"] not in nodes:
        errors.append(f"edge {e['id']}: unknown target node {e['target']['node_id']!r}")
    outgoing[e["start_node_id"]].append(e)

ids = [e["id"] for e in edges]
if len(ids) != len(set(ids)):
    errors.append("duplicate edge ids")

# every node reachable from the start
seen, stack = set(), [flow["start_node_id"]]
while stack:
    cur = stack.pop()
    if cur in seen:
        continue
    seen.add(cur)
    stack.extend(e["target"]["node_id"] for e in outgoing.get(cur, []))
if set(nodes) - seen:
    errors.append(f"unreachable nodes: {sorted(set(nodes) - seen)}")


def is_hangup(node):
    return node["type"] == "tool" and (node.get("tool") or {}).get("type") == "hangup"


for node_id, node in nodes.items():
    out = outgoing.get(node_id, [])
    if node["type"] == "speak":
        # a speak node says its line and moves on: exactly one default edge
        if len(out) != 1 or out[0]["condition"]["type"] != "default":
            errors.append(f"speak node {node_id} needs exactly one default edge")
    elif is_hangup(node):
        if out:
            errors.append(f"hangup node {node_id} must have no outgoing edges")
    elif not out:
        errors.append(f"node {node_id} is a dead end (no outgoing edges and not a hangup)")
    defaults = [e for e in out if e["condition"]["type"] == "default"]
    if len(defaults) > 1:
        errors.append(f"node {node_id} has more than one default edge")

print(f"Nodes: {len(nodes)}  Edges: {len(edges)}  Reachable: {len(seen)}/{len(nodes)}")
if errors:
    print("FAILURES:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print("All structural checks passed.")
