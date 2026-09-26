import json
import os
import sys

FLOW_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "conversation-flow.json")

with open(FLOW_PATH) as f:
    flow = json.load(f)

nodes = {n["id"]: n for n in flow["nodes"]}
edges = flow["edges"]
errors = []

# 1. start_node_id must exist
if flow["start_node_id"] not in nodes:
    errors.append(f"start_node_id {flow['start_node_id']!r} is not a valid node id")

# 2. every edge's start_node_id and target.node_id must reference real nodes
for e in edges:
    if e["start_node_id"] not in nodes:
        errors.append(f"edge {e['id']}: start_node_id {e['start_node_id']!r} not a valid node")
    tgt = e["target"]["node_id"]
    if tgt not in nodes:
        errors.append(f"edge {e['id']}: target.node_id {tgt!r} not a valid node")

# 3. every node must be reachable from start_node_id (no orphans)
from collections import defaultdict
outgoing = defaultdict(list)
for e in edges:
    outgoing[e["start_node_id"]].append(e["target"]["node_id"])

seen = set()
stack = [flow["start_node_id"]]
while stack:
    cur = stack.pop()
    if cur in seen:
        continue
    seen.add(cur)
    stack.extend(outgoing.get(cur, []))

unreachable = set(nodes) - seen
if unreachable:
    errors.append(f"unreachable nodes: {sorted(unreachable)}")

# 4. every speak node has exactly one outgoing edge, and it must be a default condition
for node_id, node in nodes.items():
    if node["type"] == "speak":
        out_edges = [e for e in edges if e["start_node_id"] == node_id]
        if len(out_edges) != 1:
            errors.append(f"speak node {node_id} has {len(out_edges)} outgoing edges, expected exactly 1")
        elif out_edges[0]["condition"]["type"] != "default":
            errors.append(f"speak node {node_id}'s single outgoing edge is not a default condition")

# 5. every node with outgoing edges must have exactly one 'default' edge, and it must be
#    last among that node's edges in array order (evaluation order = array order,
#    default always last)
by_source = defaultdict(list)
for e in edges:
    by_source[e["start_node_id"]].append(e)

for node_id, node_edges in by_source.items():
    default_edges = [e for e in node_edges if e["condition"]["type"] == "default"]
    if len(default_edges) != 1:
        errors.append(f"node {node_id} has {len(default_edges)} default edges, expected exactly 1")
    else:
        if node_edges[-1]["condition"]["type"] != "default":
            errors.append(f"node {node_id}: default edge is not last in evaluation order")

# 6. every non-start, non-close node must be reachable AND (except close_call) must have
#    at least one outgoing edge (no dead ends other than the explicit close_call)
terminal_allowed = {"n_close_call"}
for node_id in nodes:
    if node_id in terminal_allowed:
        continue
    if node_id not in by_source:
        errors.append(f"node {node_id} has no outgoing edges and is not the designated terminal node")

# 7. tool nodes: a hangup tool node must have zero outgoing edges. Any other
#    tool node MAY have zero edges (fire-and-forget), exactly one default edge
#    (proceed regardless of outcome), or a telnyx_last_tool_status_code check
#    paired with a default fallback (conditional branching) -- all three are
#    valid per the platform docs ("a tool node with no outgoing edges at all
#    is also valid -- the tool runs and the flow ends there"). What's NOT
#    valid is a status-code check with no default fallback (half-wired).
for node_id, node in nodes.items():
    if node["type"] != "tool":
        continue
    conds = [e["condition"] for e in by_source.get(node_id, [])]
    if node.get("tool_name") == "hangup":
        if conds:
            errors.append(f"hangup tool node {node_id} must have zero outgoing edges, has {len(conds)}")
        continue
    has_status_check = any(
        c["type"] == "expression"
        and c["expression"].get("type") == "comparison"
        and c["expression"]["left"].get("name") == "telnyx_last_tool_status_code"
        for c in conds
    )
    has_default = any(c["type"] == "default" for c in conds)
    if has_status_check and not has_default:
        errors.append(f"tool node {node_id} has a telnyx_last_tool_status_code check but no default fallback")

# 8. priority fields, where present, are unique per source node and ascending order matches array order
for node_id, node_edges in by_source.items():
    prioritized = [e for e in node_edges if "priority" in e]
    prios = [e["priority"] for e in prioritized]
    if len(prios) != len(set(prios)):
        errors.append(f"node {node_id}: duplicate priority values among {prios}")
    if prios != sorted(prios):
        errors.append(f"node {node_id}: priority values not in ascending array order: {prios}")

print(f"Nodes: {len(nodes)}  Edges: {len(edges)}")
print(f"Reachable from start: {len(seen)} / {len(nodes)}")

if errors:
    print("\nFAILURES:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("\nAll structural checks passed.")
