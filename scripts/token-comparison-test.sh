#!/bin/bash
# Token Consumption Comparison Test
# Compares token usage between Viking+TaskGraph architecture vs Original architecture

set -e

echo "=========================================="
echo "Token Consumption Comparison Test"
echo "=========================================="
echo ""

# Test queries
TEST_QUERIES=(
    "你好，今天天气怎么样？"
    "帮我打开浏览器访问 github.com"
    "列出当前目录的文件"
    "自动点击屏幕上的确定按钮"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_test() {
    echo -e "${GREEN}[TEST]${NC} $1"
}

# Function to extract token info from gateway log
extract_token_info() {
    local log_file="$1"
    local query="$2"

    # Look for usage information in logs
    grep -i "usage\|tokens\|completion" "$log_file" 2>/dev/null | tail -5 || echo "No token info found"
}

# Function to run a test query and capture results
run_test() {
    local query="$1"
    local config_desc="$2"

    echo ""
    log_test "Query: $query"
    echo "Configuration: $config_desc"
    echo "---"

    # Run the query
    local result
    result=$(openclaw agent --agent main --message "$query" --thinking off 2>&1)

    echo "Response: $result"
    echo ""
}

# Save current config
log_info "Saving current configuration..."
CURRENT_CONFIG=$(openclaw config get agents.defaults 2>/dev/null)
echo "$CURRENT_CONFIG" > /tmp/openclaw_config_backup.json

# Stop gateway to ensure clean state
log_info "Stopping gateway..."
openclaw gateway stop 2>/dev/null || true
sleep 2

# Test 1: With Viking+TaskGraph enabled (Current Architecture)
echo ""
echo "=========================================="
echo "TEST 1: Current Architecture (Viking + TaskGraph Enabled)"
echo "=========================================="

openclaw config set agents.defaults.viking.enabled true 2>/dev/null
openclaw config set agents.defaults.taskgraph.enabled true 2>/dev/null

log_info "Restarting gateway with Viking+TaskGraph enabled..."
openclaw gateway start 2>/dev/null || true
sleep 8

# Clear logs
> /tmp/openclaw_test1.log

for query in "${TEST_QUERIES[@]}"; do
    run_test "$query" "Viking+TaskGraph Enabled"
done 2>&1 | tee /tmp/openclaw_test1.log

# Test 2: With Viking+TaskGraph disabled (Original Architecture)
echo ""
echo "=========================================="
echo "TEST 2: Original Architecture (Viking + TaskGraph Disabled)"
echo "=========================================="

openclaw config set agents.defaults.viking.enabled false 2>/dev/null
openclaw config set agents.defaults.taskgraph.enabled false 2>/dev/null

log_info "Restarting gateway with Viking+TaskGraph disabled..."
openclaw gateway stop 2>/dev/null || true
sleep 2
openclaw gateway start 2>/dev/null || true
sleep 8

# Clear logs
> /tmp/openclaw_test2.log

for query in "${TEST_QUERIES[@]}"; do
    run_test "$query" "Original (No Viking/TaskGraph)"
done 2>&1 | tee /tmp/openclaw_test2.log

# Restore original config
echo ""
echo "=========================================="
echo "Restoring Original Configuration"
echo "=========================================="

# Parse and restore config
if [ -f /tmp/openclaw_config_backup.json ]; then
    log_info "Restoring configuration from backup..."

    # Extract individual values and restore
    VIKING_ENABLED=$(cat /tmp/openclaw_config_backup.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('viking',{}).get('enabled','true'))" 2>/dev/null || echo "true")
    TASKGRAPH_ENABLED=$(cat /tmp/openclaw_config_backup.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskgraph',{}).get('enabled','true'))" 2>/dev/null || echo "true")

    openclaw config set agents.defaults.viking.enabled "$VIKING_ENABLED" 2>/dev/null
    openclaw config set agents.defaults.taskgraph.enabled "$TASKGRAPH_ENABLED" 2>/dev/null
fi

log_info "Restarting gateway with original configuration..."
openclaw gateway stop 2>/dev/null || true
sleep 2
openclaw gateway start 2>/dev/null || true
sleep 5

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""
echo "Test logs saved to:"
echo "  - /tmp/openclaw_test1.log (Viking+TaskGraph enabled)"
echo "  - /tmp/openclaw_test2.log (Original architecture)"
echo ""
echo "To view detailed logs:"
echo "  tail -100 /Users/donald/.openclaw/logs/gateway.log"
echo ""

# Extract comparison from logs
echo "Quick Token Comparison (from gateway logs):"
echo ""
echo "=== With Viking+TaskGraph ==="
grep -E "usage|tokens|duration" /Users/donald/.openclaw/logs/gateway.log 2>/dev/null | tail -20 || echo "Check gateway.log manually"

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
