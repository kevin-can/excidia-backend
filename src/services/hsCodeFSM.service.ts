import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ChatCompletion, ChatCompletionAssistantMessageParam, ChatCompletionMessage } from 'openai/resources';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { 
    HSCode,
    HSCodeBase,
    HsDb,
    DatabaseQuery,
} from '../config/database';


interface FunctionMetadata {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
    };
}

type State = "general" | "parse_db" | "traverse";

type FunctionDictionary = {
    [key: string]: (...args: any[]) => Promise<any>;
};

dotenv.config({ path: path.join(process.cwd(), ".env") });

export class HSCodeFSM {
    private state: State;
    private currentResults: HSCode[];
    private currentNode: HSCode | null;
    private threadId: string | null;
    private readonly btkiDb: HsDb;
    private readonly openai: OpenAI;
    private readonly funcDict: FunctionDictionary;
    private readonly functionMetadata: FunctionMetadata[];

    constructor(btkiDb: HsDb) {
        this.state = "general";
        this.currentResults = [];
        this.currentNode = null;
        this.threadId = null;
        this.btkiDb = btkiDb;
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        // Bind methods
        this.queryByDescription = this.queryByDescription.bind(this);
        this.getNext = this.getNext.bind(this);
        this.confirmHscode = this.confirmHscode.bind(this);

        this.functionMetadata = [
            {
                name: "query_by_description",
                description: "Search for HS codes using product description",
                parameters: {
                    type: "object",
                    properties: {
                        user_query: { type: "string", description: "Product description" },
                        top_k: { type: "integer", description: "Number of results to return", default: 5 }
                    },
                    required: ["user_query"]
                }
            },
            {
                name: "get_next",
                description: "Get child categories for an HS code",
                parameters: {
                    type: "object",
                    properties: {
                        id_: { type: "integer", description: "Parent HS code ID" }
                    },
                    required: ["id_"]
                }
            },
            {
                name: "confirm_hscode",
                description: "Confirm final HS code selection",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        ];

        this.funcDict = {
            query_by_description: this.queryByDescription,
            get_next: this.getNext,
            confirm_hscode: this.confirmHscode
        };
    }

    async queryByDescription(userQuery: string, topK: number = 5): Promise<HSCode[]> {
        const response = await this.btkiDb.queryByDescription(userQuery, topK);
        this.currentResults = [];
        this.currentResults.push(...response);
        return response;
    }

    async getNext(id: number): Promise<HSCode[]> {
        console.log(`Getting id ${id}`);
        return this.btkiDb.findNextPID(id);
    }

    async confirmHscode(): Promise<HSCode | null> {
        const finalCode = this.currentNode ? { ...this.currentNode } : null;
        this.state = "general";
        this.currentNode = null;
        this.currentResults = [];
        return finalCode;
    }

    private async processAssistantResponse(response: OpenAI.Chat.ChatCompletionMessage): Promise<ChatCompletionMessage> {
        console.log("\n\n Processing response: \n" + response);
        let results: Array<any> = [];
        if (response.tool_calls?.length) {
            for (const toolCall of response.tool_calls!) {
                console.log("Calling function");
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                if (this.funcDict[functionName]) {
                    const result = await this.funcDict[functionName](...Object.values(functionArgs));
                    
                    if (result) {
                        if (functionName === 'query_by_description') {
                            this.currentResults = result;
                            this.state = "traverse";
                            results.push(...result)
                        } else if (functionName === 'get_next') {
                            this.currentResults = result;
                            this.currentNode = Array.isArray(result) ? result[0] : result;
                            results.push(...result)
                        } else if (functionName === 'confirm_hscode') {
                            results.push(result)
                        }
                    }
                }
            }
            return this.parseDbState(results);
        }
        console.log("Not Calling functions");
        return response;
    }

    private async parseDbState(results: HSCode[]) : Promise<OpenAI.Chat.ChatCompletionMessage> {
        console.log("Parsing DB -------------------");
        let tmpRes = ""
        results.forEach(obj => tmpRes.concat( "(" + obj.description + obj.indonesian_description + ")"));
        if (results && results.length > 0) {
            const tmpState = this.state;
            this.state = "parse_db";
            console.log("Using " + this.getSystemPromptForState() + JSON.stringify(results));
            this.state = tmpState;
            return this.runAssistantWithState("", this.getSystemPromptForState() + JSON.stringify(results));
        }
        return this.runAssistantWithState("", this.getSystemPromptForState());
    }

    private async runAssistantWithState(userInput: string, systemPrompt: string): Promise<OpenAI.Chat.ChatCompletionMessage> {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: userInput
                    }
                ],
                tools: this.functionMetadata.map(fn => ({ type: 'function', function: fn })),
                tool_choice: "auto",
                temperature: 0.1
            });

            return response.choices[0].message;
        } catch (error) {
            console.error('Assistant interaction failed:', error);
            throw error;
        }
    }

    private getSystemPromptForState(): string {
        let prompts: Record<State, string> = {
            general: "You are an assistant for Indonesian customs. Help classify HS codes through tree traversal. " +
                    "Translate the user's product description to English if necessary, then call query_by_description. " +
                    "Format function calls as:\nFunction call: query_by_description\nArguments: {\"user_query\": \"translated description\"}",
            
            parse_db: "Present the search results in the user's language. Explain each option's relevance to their product. " +
                    "Explain ONLY in the language the user speaks." +
                     "Help them select the most appropriate category by asking clarifying questions. " +
                     "If they've provided information that can eliminate some choices, do so. The choices are as follows: ",
            
            traverse:   "You are navigating through HS code categories. " + 
                        "Always explain available subcategories to the user before asking for their choice." +
                        "IF the user wants to stop or confirms the current category, call confirm_hscode with no arguments. " +
                        "ELSE, the user wants to explore subcategories, get the id_ field of the options that best matches the user choice." +
                        "Call Function call: get_next\nArguments: {\"id_\": chosen_id}\n\n" +
                        "NEVER call query_by_description. " +
                        "Choose the matching chosen id from the choices below: " + JSON.stringify(this.currentResults)
        };
        
        return prompts[this.state];
    }

    async run(userInput: string): Promise<string> {
        console.log(`Running FSM in state: ${this.state}`);
        const systemPrompt = this.getSystemPromptForState();
        console.log(systemPrompt);
        const response = await this.runAssistantWithState(userInput, systemPrompt);
        return (await this.processAssistantResponse(response)).content!;
    }
}

export default HSCodeFSM;