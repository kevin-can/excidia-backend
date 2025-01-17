// scripts/setupDynamoDB.js
import {
    DynamoDBClient,
    CreateTableCommand,
    UpdateTableCommand
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { parse } from 'csv-parse';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

// Initialize DynamoDB client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-southeast-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const docClient = DynamoDBDocumentClient.from(client);

async function createTable() {
    const params = {
        TableName: "BTKI_Entries",
        KeySchema: [
            { AttributeName: "id_", KeyType: "HASH" }  // Partition key
        ],
        AttributeDefinitions: [
            { AttributeName: "id_", AttributeType: "N" },      // For primary key
            { AttributeName: "parent_id", AttributeType: "N" }  // For GSI
        ],
        GlobalSecondaryIndexes: [
            {
                IndexName: "ParentIdIndex",
                KeySchema: [
                    { AttributeName: "parent_id", KeyType: "HASH" }
                ],
                Projection: {
                    ProjectionType: "ALL"  // Project all attributes
                },
                ProvisionedThroughput: {
                    ReadCapacityUnits: 50,
                    WriteCapacityUnits: 1000  // Increased for bulk loading
                }
            }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 10,
            WriteCapacityUnits: 1000  // Increased for bulk loading
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
            await updateTableCapacity();
        } else {
            console.error("Error creating table:", err);
            throw err;
        }
    }
}

async function updateTableCapacity() {
    const params = {
        TableName: "BTKI_Entries",
        ProvisionedThroughput: {
            ReadCapacityUnits: 10,
            WriteCapacityUnits: 1000
        },
        GlobalSecondaryIndexUpdates: [
            {
                Update: {
                    IndexName: "ParentIdIndex",
                    ProvisionedThroughput: {
                        ReadCapacityUnits: 50,
                        WriteCapacityUnits: 1000
                    }
                }
            }
        ]
    };

    try {
        const command = new UpdateTableCommand(params);
        await client.send(command);
        console.log("Table capacity updated successfully");
        // Wait for update to take effect
        await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err) {
        console.error("Error updating table capacity:", err);
        throw err;
    }
}

async function uploadData() {
    try {
        // Read CSV file
        console.log("Reading CSV file...");
        const csvData = fs.readFileSync(
            path.join(__dirname, '../data/btki_takik.csv'),
            'utf-8'
        );

        // Parse CSV data
        console.log("Parsing CSV data...");
        const records = await new Promise((resolve, reject) => {
            parse(csvData, {
                columns: true,
                skip_empty_lines: true,
                cast: (value, context) => {
                    if (value === '') return null;
                    switch (context.column) {
                        case 'id_':
                        case 'parent_id':
                        case 'depth':
                            return value ? parseInt(value) : null;
                        case 'is_leaf':
                            return value === 'True' || value === 'true';
                        default:
                            return value;
                    }
                }
            }, (err, records) => {
                if (err) reject(err);
                else resolve(records);
            });
        });

        console.log(`Starting upload of ${records.length} records...`);

        // Upload in batches
        const batchSize = 25;
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, Math.min(i + batchSize, records.length));
            const command = new BatchWriteCommand({
                RequestItems: {
                    "BTKI_Entries": batch.map(record => ({
                        PutRequest: {
                            Item: {
                                ...record,
                                id_: Number(record.id_),
                                parent_id: Number(record.parent_id),
                                depth: Number(record.depth)
                            }
                        }
                    }))
                }
            });

            try {
                await docClient.send(command);
                const progress = Math.min(i + batchSize, records.length);
                const percentage = ((progress / records.length) * 100).toFixed(1);
                console.log(`Progress: ${progress}/${records.length} records (${percentage}%)`);
            } catch (err) {
                console.error(`Error uploading batch starting at index ${i}:`, err);
                throw err;
            }
        }

        console.log("\nData upload completed successfully!");
        console.log(`Total records uploaded: ${records.length}`);

    } catch (error) {
        console.error("Error uploading data:", error);
        throw error;
    }
}

async function main() {
    try {
        console.log("Creating/updating table...");
        await createTable();

        console.log("Uploading data...");
        await uploadData();

        console.log("Setup completed successfully");
    } catch (error) {
        console.error("Setup failed:", error);
        throw error;
    }
}

main();