#!/bin/bash
set -e

# Install dependencies
npm install -g aws-cdk
npm install

# Bootstrap CDK (if not already done)
cdk bootstrap

# Deploy the stack
cdk deploy --require-approval never

# Wait for deployment to complete
echo "Waiting for deployment to complete..."
sleep 30

# Get stack outputs
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name HSCodeClassificationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`API-Endpoint`].OutputValue' \
    --output text)

DYNAMODB_TABLE=$(aws cloudformation describe-stacks \
    --stack-name HSCodeClassificationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`DynamoDB-Table-Name`].OutputValue' \
    --output text)

# Create .env file with outputs
cat << EOF > .env
API_ENDPOINT=$API_ENDPOINT
DYNAMODB_TABLE=$DYNAMODB_TABLE
AWS_REGION=$(aws configure get region)
EOF

echo "Setup complete! Environment variables have been written to .env"