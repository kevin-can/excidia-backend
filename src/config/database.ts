// config/database.ts
import weaviate, { BaseNearOptions, NearTextOptions, WeaviateClient } from 'weaviate-client';
import dotenv from 'dotenv';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
    DynamoDBDocumentClient, 
    QueryCommand, 
    GetCommand,
    QueryCommandInput,
    GetCommandInput 
} from "@aws-sdk/lib-dynamodb";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

// Base interfaces for HS Codes
export interface HSCodeBase {
    description: string;
    indonesian_description: string;
    hs_code: string;
}

export interface HSCode extends HSCodeBase {
    id_: number;
    parent_id: number;
    depth: number;
    is_leaf: boolean;
}

// Database query interface
export interface DatabaseQuery {
    [key: string]: any;
}

// Interface for search results
export interface SearchResult {
    description: string;
    distance?: number;
    id?: string;
    properties: HSCode;
}

// Interface for predicting HS codes
export interface HsDb {
    findNextPID: (pid: number) => Promise<HSCode[]>;
    queryByDescription: (userQuery: string, topK: number) => Promise<HSCode[]>;
    findOneHS: (hs_code: string) => Promise<HSCodeBase[]>;
}
// Weaviate schema interface
export interface WeaviateSchema {
    class: string;
    description: string;
    vectorizer: string;
    moduleConfig: {
        [key: string]: {
            model?: string;
            options?: {
                waitForModel: boolean;
            };
        };
    };
    properties: Array<{
        name: string;
        dataType: string[];
        description: string;
        moduleConfig?: {
            [key: string]: {
                skip: boolean;
                vectorize: boolean;
            };
        };
        indexInverted?: boolean;
    }>;
}


export const WeaviateDB = await weaviate.connectToWeaviateCloud(
    process.env.WEAVIATE_HOST!, { // Replace WEAVIATE_INSTANCE_URL with your instance URL
      authCredentials: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY!),
      headers: {
        'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY!,
        'X-HuggingFace-Api-Key': process.env.HUGGINGFACE_API_KEY!
      }
    }
  )

// Initialize DynamoDB client with v3 SDK
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

// HS inference implementation
export const hsDb: HsDb = {
    findOneHS: async (hs_code: string): Promise<HSCodeBase[]> => {
        try {
            const params : QueryCommandInput = {
                TableName: "additional-hs",
                IndexName: "ParentIdIndex",
                KeyConditionExpression: "parent_id = :hs_code",
                ExpressionAttributeValues: {
                    ":hs_code": hs_code
                }
            };
            
            const command = new QueryCommand(params);
            const result = await dynamoClient.send(command);
            return (result.Items || []) as HSCode[];
        } catch (error) {
            console.error('HS database query error:', error);
            throw error;
        }
    },

    findNextPID: async (pid: number): Promise<HSCode[]> => {
        try {
            const params: QueryCommandInput = {
                TableName: 'BTKI_Entries',
                IndexName: "ParentIdIndex",
                KeyConditionExpression: "parent_id = :pid",
                ExpressionAttributeValues: {
                    ":pid": Number(pid)
                }
            };
            const command = new QueryCommand(params);
            const result = await dynamoClient.send(command);
            return (result.Items || []) as HSCode[];
        } catch (error) {
            console.error('BTKI database query error:', error);
            throw error;
        }
    },

    queryByDescription: async (userQuery: string, topK: number): Promise<HSCode[]> => {
        while (true) {
            try {
                const response = await WeaviateDB.
                  collections
                  .get('hs_codes_transformer')
                  .query
                  .nearText(userQuery,  {
                      limit: topK,
                      returnMetadata: ['distance', 'certainty']
                  })
            
                  if (!response.objects) {
                      console.log('No results found for query:', userQuery);
                      return [];
                    }
                
                    // Log some debug information
                    console.log(`Found ${response.objects.length} results`);
                    response.objects.forEach((item) => {
                      console.log(`Match: ${item.properties.description}`);
                      console.log(`Certainty: ${item.metadata!.certainty}`);
                      console.log(`Distance: ${item.metadata!.distance}`);
                      console.log('---');
                    });
                    const unk_resp : unknown = response.objects.map(resp => resp.properties);
                    return unk_resp as HSCode[];
              } catch (error) {
                console.error('GraphQL query error:', error);
                // throw error;
              }
        }
    }
};

// Function to initialize Weaviate schema
export async function initializeWeaviateSchema(): Promise<void> {
    try {
        const schemaExists = await WeaviateDB.collections.get('hs_codes_transformer');
        if (schemaExists) {
            console.log('Weaviate schema already exists');
            return;
        }

        const schema: WeaviateSchema = {
            "class": "hs_codes_transformer",  // Updated collection name
            "description": "HS Codes and their descriptions",
            "vectorizer": "text2vec-huggingface",
            "moduleConfig": {
                "text2vec-huggingface": {
                    "model": "sentence-transformers/all-MiniLM-L12-v2",
                    "options": {
                        "waitForModel": true
                    }
                }
            },
            "properties": [
                {
                    "name": "description",
                    "dataType": ["text"],
                    "description": "The description of the HS code",
                    "moduleConfig": {
                        "text2vec-huggingface": {
                            "skip": false,
                            "vectorize": true
                        }
                    }
                },
                {
                    "name": "indonesian_description",
                    "dataType": ["text"],
                    "description": "The Indonesian description of the HS code"
                },
                {
                    "name": "hs_code",
                    "dataType": ["string"],
                    "description": "The HS code identifier",
                    "indexInverted": true
                },
                {
                    "name": "id_",
                    "dataType": ["int"],
                    "description": "Internal identifier",
                    "indexInverted": true
                },
                {
                    "name": "parent_id",
                    "dataType": ["int"],
                    "description": "Parent node identifier",
                    "indexInverted": true
                },
                {
                    "name": "depth",
                    "dataType": ["int"],
                    "description": "Depth in the HS code tree"
                },
                {
                    "name": "is_leaf",
                    "dataType": ["boolean"],
                    "description": "Whether this is a leaf node"
                }
            ]
        };

        // await WeaviateDB.schema
        //     .classCreator()
        //     .withClass(schema)
        //     .do();

        console.log('Weaviate schema initialized successfully');
    } catch (error) {
        console.error('Error initializing Weaviate schema:', error);
        throw error;
    }
}
// Export database configuration
export default {
    hsDb,
    initializeWeaviateSchema
};