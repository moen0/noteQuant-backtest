def find_liquidity_levels(swings, tolerance=0.015, max_distance=100):
    levels = []
    highs = [s for s in swings if s["type"] == "high"]
    lows = [s for s in swings if s["type"] == "low"]

    used = set()
    for i, h1 in enumerate(highs):
        if i in used:
            continue
        cluster = [h1]
        for j, h2 in enumerate(highs):
            if j != i and j not in used:
                if abs(h1["price"] - h2["price"]) <= tolerance and abs(h1["index"] - h2["index"]) <= max_distance:
                    cluster.append(h2)
                    used.add(j)
        if len(cluster) >= 2:
            avg_price = sum(s["price"] for s in cluster) / len(cluster)
            levels.append({
                "price": avg_price,
                "type": "equal_highs",
                "count": len(cluster),
                "indexes": [s["index"] for s in cluster],
            })
        used.add(i)

    used = set()
    for i, l1 in enumerate(lows):
        if i in used:
            continue
        cluster = [l1]
        for j, l2 in enumerate(lows):
            if j != i and j not in used:
                if abs(l1["price"] - l2["price"]) <= tolerance and abs(l1["index"] - l2["index"]) <= max_distance:
                    cluster.append(l2)
                    used.add(j)
        if len(cluster) >= 2:
            avg_price = sum(s["price"] for s in cluster) / len(cluster)
            levels.append({
                "price": avg_price,
                "type": "equal_lows",
                "count": len(cluster),
                "indexes": [s["index"] for s in cluster],
            })
        used.add(i)

    return levels
