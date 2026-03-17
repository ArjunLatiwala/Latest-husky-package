#!/bin/sh

# run-ci-checks.sh - Smoke & Newman Tests
# Pre-push hook that runs smoke tests and Newman API tests

set -e  # Exit on any error

echo ""
echo "=================================================="
echo "🚀 [CI] Starting Smoke & Newman Tests"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables
SERVER_PID=""
SERVER_PORT=""
PROJECT_ROOT=""

# ---------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------

log_info() {
    echo "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo "${RED}[ERROR]${NC} $1"
}

# ---------------------------------------------------------------
# Project Detection
# ---------------------------------------------------------------

find_project_root() {
    local current_dir="$PWD"
    
    # Traverse up to find package.json
    while [ "$current_dir" != "/" ]; do
        if [ -f "$current_dir/package.json" ]; then
            echo "$current_dir"
            return 0
        fi
        current_dir="$(dirname "$current_dir")"
    done
    
    return 1
}

detect_project_type() {
    local pkg_json="$1"
    
    if grep -q '"react"' "$pkg_json" 2>/dev/null; then
        echo "react"
    elif grep -q '"vue"' "$pkg_json" 2>/dev/null; then
        echo "vue"
    elif grep -q '"angular"' "$pkg_json" 2>/dev/null; then
        echo "angular"
    elif grep -q '"express"' "$pkg_json" 2>/dev/null; then
        echo "express"
    elif grep -q '"next"' "$pkg_json" 2>/dev/null; then
        echo "next"
    else
        echo "node"
    fi
}

# ---------------------------------------------------------------
# Port Detection
# ---------------------------------------------------------------

detect_server_port() {
    local port=""
    
    # 1. Check .env file
    if [ -f ".env" ]; then
        port=$(grep -E "^PORT=" .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \t\r\n')
        if [ -n "$port" ]; then
            log_info "Port found in .env: $port"
            echo "$port"
            return 0
        fi
    fi
    
    # 2. Check .env.local
    if [ -f ".env.local" ]; then
        port=$(grep -E "^PORT=" .env.local 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \t\r\n')
        if [ -n "$port" ]; then
            log_info "Port found in .env.local: $port"
            echo "$port"
            return 0
        fi
    fi
    
    # 3. Check package.json scripts
    if [ -f "package.json" ]; then
        port=$(node -e "
            try {
                const pkg = require('./package.json');
                const scripts = pkg.scripts || {};
                const scriptStr = JSON.stringify(scripts);
                const match = scriptStr.match(/PORT[=:]?\s*([0-9]{4,5})/);
                if (match) console.log(match[1]);
            } catch (e) {}
        " 2>/dev/null)
        if [ -n "$port" ]; then
            log_info "Port found in package.json: $port"
            echo "$port"
            return 0
        fi
    fi
    
    # 4. Scan source files for common patterns
    local src_dirs="src server app lib"
    for dir in $src_dirs; do
        if [ -d "$dir" ]; then
            port=$(find "$dir" -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" 2>/dev/null | \
                head -10 | xargs grep -hE "\.(listen|port)\s*[\(\[]\s*([0-9]{4,5})" 2>/dev/null | \
                grep -oE "[0-9]{4,5}" | head -1)
            if [ -n "$port" ]; then
                log_info "Port found in source files: $port"
                echo "$port"
                return 0
            fi
        fi
    done
    
    # 5. Default to common ports
    log_warning "No port detected, will check common ports"
    echo ""
}

# ---------------------------------------------------------------
# Port Cleanup
# ---------------------------------------------------------------

kill_processes_on_port() {
    local port="$1"
    if [ -z "$port" ]; then
        return 0
    fi
    
    log_info "Checking for processes on port $port..."
    
    # Find PIDs using the port (try lsof first, then netstat as fallback)
    local pids=""
    if command -v lsof >/dev/null 2>&1; then
        pids=$(lsof -ti:$port 2>/dev/null || true)
    elif command -v netstat >/dev/null 2>&1; then
        pids=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' || true)
    else
        log_warning "Neither lsof nor netstat available, cannot check port $port"
        return 0
    fi
    
    if [ -n "$pids" ]; then
        log_warning "Found processes on port $port: $pids"
        for pid in $pids; do
            log_info "Killing process $pid on port $port"
            kill "$pid" 2>/dev/null || true
            sleep 1
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                log_info "Force killing process $pid"
                kill -9 "$pid" 2>/dev/null || true
            fi
        done
        sleep 2  # Give port time to be released
    else
        log_info "No processes found on port $port"
    fi
}

# ---------------------------------------------------------------
# Server Health Check
# ---------------------------------------------------------------

wait_for_server() {
    local timeout=30
    local interval=1
    local count=0
    local detected_port="$1"
    
    # Build port list to check
    local port_list=""
    if [ -n "$detected_port" ]; then
        port_list="$detected_port"
    else
        port_list="3000 3001 8000 8080 5000 4000 4200 9000 1337"
    fi
    
    log_info "Waiting for server to start (timeout: ${timeout}s)..."
    
    while [ $count -lt $timeout ]; do
        # Check if server process is still running
        if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
            log_error "Server process died during startup"
            return 1
        fi
        
        # Check each port in the list
        for port in $port_list; do
            if curl -sf "http://localhost:$port" >/dev/null 2>&1; then
                SERVER_PORT="$port"
                log_success "Server is running on port $port"
                return 0
            fi
        done
        
        sleep $interval
        count=$((count + 1))
        echo -n "."
    done
    
    echo ""
    log_error "Server did not start within ${timeout} seconds"
    return 1
}

# ---------------------------------------------------------------
# Smoke Tests
# ---------------------------------------------------------------

run_smoke_tests() {
    echo ""
    echo "=================================================="
    echo "🔥 [SMOKE TESTS] Starting server verification"
    echo "=================================================="
    
    # Check if we're in a Node.js project
    if [ ! -f "package.json" ]; then
        log_warning "No package.json found, skipping smoke tests"
        return 0
    fi
    
    # Detect available start scripts
    local start_cmd=""
    if npm run | grep -q "start"; then
        start_cmd="npm start"
    elif npm run | grep -q "dev"; then
        start_cmd="npm run dev"
    elif npm run | grep -q "serve"; then
        start_cmd="npm run serve"
    else
        log_warning "No start/dev/serve script found in package.json"
        log_info "Available scripts:"
        npm run 2>/dev/null | grep -E "^\s*[a-zA-Z]" | head -5
        return 0
    fi
    
    log_info "Starting server with: $start_cmd"
    
    # Detect server port first
    local detected_port=$(detect_server_port)
    
    # Kill any existing processes on detected/default ports
    if [ -n "$detected_port" ]; then
        kill_processes_on_port "$detected_port"
    else
        # Check common ports and kill any processes found
        for port in 3000 3001 8000 8080 5000 4000 4200 9000 1337; do
            local port_in_use=""
            if command -v lsof >/dev/null 2>&1; then
                port_in_use=$(lsof -ti:$port 2>/dev/null || true)
            elif command -v netstat >/dev/null 2>&1; then
                port_in_use=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' || true)
            fi
            if [ -n "$port_in_use" ]; then
                kill_processes_on_port "$port"
                break  # Only clean the first occupied port
            fi
        done
    fi
    
    # Set Node.js options for older projects
    local node_version=$(node -v | cut -d. -f1 | tr -d 'v')
    if [ "$node_version" -ge 17 ]; then
        export NODE_OPTIONS="--openssl-legacy-provider"
    fi
    
    # Start server in background
    $start_cmd > /tmp/smoke-test-server.log 2>&1 &
    SERVER_PID=$!
    
    # Wait for server to be ready
    if wait_for_server "$detected_port"; then
        log_success "Smoke test passed - server is responding"
        return 0
    else
        log_error "Smoke test failed - server not responding"
        if [ -f "/tmp/smoke-test-server.log" ]; then
            log_error "Server logs:"
            cat /tmp/smoke-test-server.log
        fi
        cleanup
        return 1
    fi
}

# ---------------------------------------------------------------
# Newman Tests
# ---------------------------------------------------------------

run_newman_tests() {
    echo ""
    echo "=================================================="
    echo "🧪 [NEWMAN TESTS] Starting API tests"
    echo "=================================================="
    
    # Find Postman collections
    local collections=$(find . -name "*.postman_collection.json" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)
    
    if [ -z "$collections" ]; then
        log_warning "No Postman collections found"
        log_info "Expected file pattern: *.postman_collection.json"
        return 0
    fi
    
    # Check if Newman is installed
    if ! command -v newman >/dev/null 2>&1; then
        log_info "Installing Newman..."
        npm install -g newman newman-reporter-htmlextra >/dev/null 2>&1 || {
            log_error "Failed to install Newman"
            return 1
        }
    fi
    
    # Create reports directory
    mkdir -p newman-reports
    
    # Find environment file
    local env_file=$(find . -name "*.postman_environment.json" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -1)
    
    # Run each collection
    local failed=0
    for collection in $collections; do
        local collection_name=$(basename "$collection" .postman_collection.json)
        log_info "Running collection: $collection_name"
        
        # Build Newman command
        local newman_cmd="newman run '$collection'"
        
        # Add environment if found
        if [ -n "$env_file" ]; then
            newman_cmd="$newman_cmd --environment '$env_file'"
            log_info "Using environment: $(basename "$env_file")"
        fi
        
        # Set base URL to server port
        local base_url="http://localhost:${SERVER_PORT:-3000}"
        newman_cmd="$newman_cmd --env-var baseUrl=$base_url"
        
        # Add reporters
        newman_cmd="$newman_cmd --reporters cli,htmlextra"
        newman_cmd="$newman_cmd --reporter-htmlextra-export 'newman-reports/${collection_name}-report.html'"
        
        # Run with bail on first failure
        newman_cmd="$newman_cmd --bail"
        
        # Execute Newman
        if eval "$newman_cmd"; then
            log_success "Collection '$collection_name' passed"
        else
            log_error "Collection '$collection_name' failed"
            failed=1
            break
        fi
    done
    
    if [ $failed -eq 1 ]; then
        log_error "Newman tests failed"
        return 1
    else
        log_success "All Newman tests passed"
        return 0
    fi
}

# ---------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        log_info "Stopping server (PID: $SERVER_PID)"
        kill "$SERVER_PID" 2>/dev/null || true
        # Wait a bit for graceful shutdown
        sleep 2
        # Force kill if still running
        kill -9 "$SERVER_PID" 2>/dev/null || true
    fi
    
    # Clean up temp files
    rm -f /tmp/smoke-test-server.log
}

# ---------------------------------------------------------------
# Main Execution
# ---------------------------------------------------------------

main() {
    # Find project root
    PROJECT_ROOT=$(find_project_root)
    if [ $? -ne 0 ]; then
        log_error "Could not find project root (no package.json)"
        exit 1
    fi
    
    log_info "Project root: $PROJECT_ROOT"
    cd "$PROJECT_ROOT" || exit 1
    
    # Detect project type
    local project_type=$(detect_project_type "package.json")
    log_info "Project type: $project_type"
    
    # Set up cleanup trap
    trap cleanup EXIT INT TERM
    
    # Run smoke tests
    if ! run_smoke_tests; then
        log_error "Smoke tests failed"
        exit 1
    fi
    
    # Run Newman tests
    if ! run_newman_tests; then
        log_error "Newman tests failed"
        exit 1
    fi
    
    echo ""
    echo "=================================================="
    log_success "✅ All tests passed successfully!"
    echo "=================================================="
}

# Run main function
main "$@"
