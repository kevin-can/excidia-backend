import { OpenAI } from 'openai';
import { HsDb } from '../config/database.js';
import { ChatCompletionMessage } from 'openai/resources';
import { NullValue } from 'weaviate-client/dist/node/cjs/proto/google/protobuf/struct.js';

interface HSCode {
    description: string;
    indonesian_description: string;
    hs_code: string;
    id_: number;
    parent_id: number;
    depth: number;
    is_leaf: boolean;
}

type FSMState = 'general' | 'parse_db' | 'traverse';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface AssistantMessage extends ChatMessage {
    tool_calls?: Array<{
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

interface FSMStateObject {
    state: FSMState;
    currentResults: HSCode[];
    currentNode: HSCode | null;
}

type ChatCompletionResponse = {
    id: string; // Unique identifier for the completion
    object: "chat.completion"; // Type of object
    created: number; // Timestamp of creation
    model: string; // Model used (e.g., 'gpt-4')
    choices: Array<{
      message: ChatCompletionMessage; // Message content and role
      finish_reason: "stop" | "length" | "content_filter" | null; // Reason for completion
      index: number; // Index of the choice
    }>;
    usage: {
      prompt_tokens: number; // Tokens in the prompt
      completion_tokens: number; // Tokens in the completion
      total_tokens: number; // Total tokens used
    };
  };

export interface ChatRequest {
    messages: ChatMessage[];
    stateObject: FSMStateObject;
}

export interface ChatOutput {
    message: string | HSCode[];
    stateObject: FSMStateObject;
}

export class HSCodeFSM {
    private state: FSMState;
    private currentResults: HSCode[];
    private currentNode: HSCode | null;
    private threadId: string | null;
    private clientDb: any;
    private btkiDb: any;
    private openai: OpenAI;
    private funcDict: { [key: string]: Function };
    private promptDict: { [key in FSMState]: string };
    private functions: Array<{
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                [key: string]: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    }>;

    constructor(btkiDb: HsDb) {
        this.state = "general";
        this.currentResults = [];
        this.currentNode = null;
        this.threadId = null;
        this.btkiDb = btkiDb;
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        this.queryByDescription = this.queryByDescription.bind(this);
        this.getNext = this.getNext.bind(this);
        this.confirmHscode = this.confirmHscode.bind(this);

        this.funcDict = {
            query_by_description: this.queryByDescription,
            get_next: this.getNext,
            confirm_hscode: this.confirmHscode
        };

        this.promptDict = {
            general: "You are an assistant for Indonesian customs. Help classify HS codes through tree traversal. " +
                    "Translate the user's product description to English if necessary, then call query_by_description. " +
                    "Format function calls as:\nFunction call: query_by_description\nArguments: {\"user_query\": \"translated description\"}",
            
            parse_db: "Present the search results in the user's language. Explain each option's relevance to their product. " +
                    "Explain ONLY in the language the user speaks." +
                     "Help them select the most appropriate category by asking clarifying questions. " +
                     "If they've provided information that can eliminate some choices, do so. The choices are as follows: ",
            
            traverse: "You are navigating through HS code categories. " + 
                     "Always explain available subcategories to the user before asking for their choice." +
                     "IF AND ONLY IF the use chose a choice with is_leaf == true, call confirm_hscode with no arguments. " +
                     "ELSE, the user wants to explore subcategories, get the id_ field of the options that best matches the user choice." +
                     "Call Function call: get_next\nArguments: {\"id_\": chosen_id}\n\n" +
                     "NEVER call query_by_description" +
                     "Choose the matching chosen id from the choices below: "
        };

        this.functions = [
            {
                name: "query_by_description",
                description: "Search for HS codes based on product description",
                parameters: {
                    type: "object",
                    properties: {
                        user_query: {
                            type: "string",
                            description: "Product description to search for"
                        },
                        topK: {
                            type: "string",
                            description: "Number of results to return"
                        }
                    },
                    required: ["user_query"]
                }
            },
            {
                name: "get_next",
                description: "Get subcategories for a given HS code",
                parameters: {
                    type: "object",
                    properties: {
                        id_: {
                            type: "string",
                            description: "ID of the HS code to get subcategories for"
                        }
                    },
                    required: ["id_"]
                }
            },
            {
                name: "confirm_hscode",
                description: "Confirm the selected HS code",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        ];
    }

    async queryByDescription(userQuery: string, topK: number = 5): Promise<HSCode[]> {
        return await this.btkiDb.queryByDescription(userQuery, topK);
    }

    async getNext(id: number): Promise<HSCode[]> {
        console.log(`Getting id ${id}`);
        return this.btkiDb.findNextPID(id);
    }

    async confirmHscode(): Promise<HSCode | null> {
        return null;
    }

    private async runAssistantWithState(userInput: string, systemPrompt: string): Promise<ChatCompletionMessage> {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userInput }
                ],
                functions: this.functions,
                function_call: "auto",
                temperature: 0.1
            });

            return response.choices[0].message;
        } catch (error) {
            console.error('Assistant interaction failed:', error);
            throw error;
        }
    }

    private async processAssistantResponse(
        response: ChatCompletionMessage,
        stateObject: FSMStateObject
    ): Promise<ChatOutput> {
        console.log("\n\n Processing response: \n");
        console.log("System gave response" + JSON.stringify(response.function_call));
        let results: HSCode[] = [];
        let newStateObject = { ...stateObject };
        if (response.function_call) {
            console.log("Calling function");
            // for (const toolCall of response) {
            const toolCall = response.function_call!;
                const functionName = toolCall.name;
                const functionArgs = JSON.parse(toolCall.arguments);

                if (this.funcDict[functionName]) {
                    const result = await this.funcDict[functionName](...Object.values(functionArgs));
                    
                    if (result) {
                        if (functionName === 'query_by_description') {
                            results.push(...result);
                            newStateObject = {
                                state: 'traverse',
                                currentResults: result,
                                currentNode: null
                            };
                        } else if (functionName === 'get_next') {
                            results.push(...result);
                            newStateObject = {
                                state: stateObject.state,
                                currentResults: result,
                                currentNode: Array.isArray(result) ? result[0] : result
                            };
                        } else if (functionName === 'confirm_hscode') {
                            results.push(result);
                            newStateObject = {
                                state: 'general',
                                currentResults: [],
                                currentNode: null
                            };
                        }
                    }
                }
            // }
            return { message: results, stateObject: newStateObject };
        }

        return { 
            message: response.content || '',
            stateObject: newStateObject 
        };
    }

    async run(chatRequest: ChatRequest): Promise<ChatOutput> {
        const { messages, stateObject } = chatRequest;
        let systemPrompt = this.promptDict[stateObject.state];
        console.log(messages[messages.length - 1].content);
        
        if (stateObject.state === 'traverse') {
            systemPrompt = systemPrompt + JSON.stringify(stateObject.currentResults);
        }

        const assistantResponse = await this.runAssistantWithState(
            messages[messages.length - 1].content, 
            systemPrompt
        );

        return await this.processAssistantResponse(assistantResponse, stateObject);
    }
}

export default HSCodeFSM;