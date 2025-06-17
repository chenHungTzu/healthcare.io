#!/bin/bash

# Aurora Database Cleanup Script
# This script cleans up the Aurora PostgreSQL database for Bedrock Knowledge Base

# Prevent CLI pagination and interactive prompts
export AWS_PAGER=""
export AWS_CLI_AUTO_PROMPT=off

# Set variables
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id BedrockUserSecret --region ap-northeast-1 --query ARN --output text)
CLUSTER_ARN="arn:aws:rds:ap-northeast-1:${ACCOUNT_ID}:cluster:healthcare-kb-aurora-cluster"
DATABASE_NAME="healthcare_db"
REGION="ap-northeast-1"

echo "Starting Aurora database cleanup..."
echo "Account ID: $ACCOUNT_ID"
echo "Cluster ARN: $CLUSTER_ARN"
echo "Secret ARN: $SECRET_ARN"

# Function to execute SQL statement
execute_sql() {
    local sql_command="$1"
    local description="$2"
    local show_output="${3:-false}"
    
    echo "Executing: $description"
    
    if [ "$show_output" = "true" ]; then
        # Show output for informational queries
        aws rds-data execute-statement \
            --resource-arn "${CLUSTER_ARN}" \
            --secret-arn "${SECRET_ARN}" \
            --database "${DATABASE_NAME}" \
            --sql "${sql_command}" \
            --region "${REGION}" \
            --output table 2>/dev/null | head -20
        echo "... (output truncated for readability)"
    else
        # Silent execution for DDL statements
        aws rds-data execute-statement \
            --resource-arn "${CLUSTER_ARN}" \
            --secret-arn "${SECRET_ARN}" \
            --database "${DATABASE_NAME}" \
            --sql "${sql_command}" \
            --region "${REGION}" \
            --output text >/dev/null 2>&1
    fi
    
    if [ $? -eq 0 ]; then
        echo "✅ Success: $description"
    else
        echo "❌ Failed: $description"
        exit 1
    fi
}

# Wait for database to be ready
echo "Waiting for database to be ready..."
sleep 10

# 1. Drop existing table if exists
execute_sql "DROP TABLE IF EXISTS knowledge_base_table CASCADE;" "Dropping existing knowledge_base_table"

# 2. Drop vector extension if exists
execute_sql "DROP EXTENSION IF EXISTS vector CASCADE;" "Dropping vector extension"

# 3. Create vector extension
execute_sql "CREATE EXTENSION IF NOT EXISTS vector;" "Creating vector extension"

# 4. Create knowledge base table
TABLE_SQL="CREATE TABLE knowledge_base_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunks TEXT NOT NULL,
    metadata JSONB,
    embedding vector(1536),
    custommetadata JSONB
);"
execute_sql "${TABLE_SQL}" "Creating knowledge_base_table"

# 5. Create GIN index for chunks (required by Bedrock)
execute_sql "CREATE INDEX idx_chunks_gin ON knowledge_base_table USING gin (to_tsvector('simple', chunks));" "Creating GIN index for chunks"

# 6. Create vector index for embeddings (HNSW required by Bedrock)
execute_sql "CREATE INDEX idx_embedding ON knowledge_base_table USING hnsw (embedding vector_cosine_ops);" "Creating HNSW vector index for embeddings"

# 7. Create GIN index for custommetadata (required by Bedrock)
execute_sql "CREATE INDEX idx_custommetadata_gin ON knowledge_base_table USING gin (custommetadata);" "Creating GIN index for custommetadata"

# 8. List all tables and their schemas
echo ""
echo "📋 Listing all tables and their schemas:"
execute_sql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';" "Listing all tables" "true"

echo ""
echo "📋 Detailed schema for knowledge_base_table:"
execute_sql "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'knowledge_base_table' ORDER BY ordinal_position;" "Getting table schema" "true"

echo ""
echo "📋 Listing all indexes:"
execute_sql "SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;" "Listing all indexes" "true"

echo ""
echo "📋 Checking vector extension:"
execute_sql "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';" "Checking vector extension status" "true"

echo ""
echo "🎉 Database cleanup and setup completed successfully!"
echo ""
echo "Created:"
echo "  - knowledge_base_table with proper schema"
echo "  - GIN index on chunks column (required by Bedrock)"
echo "  - Vector index on embedding column"
echo "  - Vector extension enabled"
echo ""
echo "The database is now ready for Bedrock Knowledge Base integration."
