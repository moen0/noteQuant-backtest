def find_liquidity_levels(swings, tolerance=0.015, max_distance=100):
    levels = []
    highs = [s for s in swings if s["type"] == "high"]
    lows = [s for s in swings if s["type"] == "low"]

    _cluster_swings(highs, tolerance, max_distance, "equal_highs", levels)
    _cluster_swings(lows, tolerance, max_distance, "equal_lows", levels)

    return levels


def _cluster_swings(points, tolerance, max_distance, level_type, levels):
    if not points:
        return
    sorted_points = sorted(points, key=lambda s: s["price"])
    i = 0
    while i < len(sorted_points):
        cluster = [sorted_points[i]]
        j = i + 1
        while j < len(sorted_points):
            if abs(sorted_points[j]["price"] - sorted_points[i]["price"]) > tolerance:
                break
            if abs(sorted_points[j]["index"] - sorted_points[i]["index"]) <= max_distance:
                cluster.append(sorted_points[j])
            j += 1
        if len(cluster) >= 2:
            avg_price = sum(s["price"] for s in cluster) / len(cluster)
            levels.append({
                "price": avg_price,
                "type": level_type,
                "count": len(cluster),
                "indexes": [s["index"] for s in cluster],
            })
        i += 1
