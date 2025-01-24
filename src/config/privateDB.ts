import dotenv from 'dotenv';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
    DynamoDBDocumentClient, 
    QueryCommand, 
    GetCommand,
    QueryCommandInput,
    GetCommandInput, 
    PutCommand
} from "@aws-sdk/lib-dynamodb";

import path from 'path';
import { fileURLToPath } from 'url';
import { get } from 'http';
import { RecordTarget, RecordType } from 'aws-cdk-lib/aws-route53';
import { unmarshallOutput } from '@aws-sdk/lib-dynamodb/dist-types/commands/utils';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type UserRecordType = "classified_good" 
                            | "sell_item_active" 
                            | "sell_item_non_active"
                            | "bought_item"
                            | "user_registration"
                            | "shipping_date"
                            | "loan_request";

const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});

const dynamoClient = DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: {
        removeUndefinedValues: true,
    }
});

export interface userDB {
    addClassifiedGood : (username: string, productName: string, productDesc: string,  hsCode: String, regulasi? : String) => Promise<void>;
    getClassifiedList : (username: string) => Promise<ClassifiedGoodType[]>;
}

export interface ClassifiedGoodType {
    userID : string,
    type : UserRecordType,
    product_desc : string,
    hsCode : string,
    regulasi: string,
    document_pic : Array<string>,
    regulasi_topic : Array<string>,
    regulasi_desc : Array<string>
}

export const privateDB : userDB = {
    addClassifiedGood : async (username: string, productName: string, productDesc: string,  hsCode: String, regulasi? : String) : Promise<void> => {
        const command = new PutCommand({
                TableName : "PersonalData",
                Item: {
                    userID : username,
                    type : "classified_good",
                    product_desc : productDesc,
                    hsCode : hsCode,
                    regulasi: regulasi,
                    document_pic : []
                }
        });

        try {
            await dynamoClient.send(command);
            console.log(`Finished uploading classified goods`);
        } catch (err) {
            console.error(`Error uploading classified goods`);
            throw err;
        }
    },

    getClassifiedList : async (username: string) : Promise<ClassifiedGoodType[]> => {
        const params: QueryCommandInput = {
            TableName: 'PersonalData',
            KeyConditionExpression: 'userID = :username',
            IndexName: 'type',
            FilterExpression: 'userID = :username AND type = :request_type',
            ExpressionAttributeValues: {
                ':username': { S: username },
                // Add other attribute values for filter
                ':request_type': { S: 'classified_good' }
            }
        };
    
        try {
            const command = new QueryCommand(params);
            const response = await dynamoClient.send(command);
    
            // Cast results to UserEntry type
            const results: ClassifiedGoodType[] = response.Items?.map(item => 
                unmarshall(item) as ClassifiedGoodType
            ) || [];
    
            return results;
        } catch (error) {
            console.error('Query failed', error);
            throw error;
        }
    }
}
