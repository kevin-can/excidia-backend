import {
    DynamoDBClient,
    CreateTableCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { fromEnv } from "@aws-sdk/credential-providers";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-southeast-1',
    credentials: fromEnv()
});
async function main() {
    const docClient = DynamoDBDocumentClient.from(client);
    const params = {
        TableName: "PersonalData",
        AttributeDefinitions: [
            { AttributeName: "userID", AttributeType: "S" },
            { AttributeName: "date", AttributeType: "S"},
        ],
        KeySchema: [
            { AttributeName: "userID", KeyType: "HASH" }, // Partition key
            { AttributeName: "date", KeyType: "RANGE"},
        ],
        LocalSecondaryIndexes : [
            { 
                IndexName: "type", 
                KeySchema: [
                    { AttributeName: "userID", KeyType: "HASH" }, // Partition key
                    { AttributeName: "date", KeyType: "RANGE"}
                ],
                Projection: {
                    ProjectionType: 'ALL'
                }
            }
        ]
        ,
        ProvisionedThroughput: {
            ReadCapacityUnits: 100,
            WriteCapacityUnits: 10
        }
    };
    
    try {
        const command = new CreateTableCommand(params);
        const response = await client.send(command);
        console.log("Table created successfully:", response);
        // Wait for table to be active
        await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (err) {
        if (err.name === 'ResourceInUseException') {
            console.log("Table already exists, updating capacity...");
//            await updateTableCapacity();
        } else {
            console.error("Error creating table:", err);
            throw err;
        }
    }
}

main()