"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSCodeFSM = void 0;
const openai_1 = __importDefault(require("openai"));
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ path: path.join(process.cwd(), ".env") });
class HSCodeFSM {
    constructor(clientDb, btkiDb) {
        this.state = "general";
        this.currentResults = [];
        this.currentNode = null;
        this.threadId = null;
        this.clientDb = clientDb;
        this.btkiDb = btkiDb;
        this.openai = new openai_1.default({
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
    queryByDescription(userQuery_1) {
        return __awaiter(this, arguments, void 0, function* (userQuery, topK = 5) {
            const hsData = yield this.clientDb.collections.get("hs_codes_transformer");
            const response = yield hsData.query.nearText({
                query: userQuery,
                limit: topK
            });
            return response.objects.map(resp => resp.properties);
        });
    }
    getNext(id) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Getting id ${id}`);
            return this.btkiDb.find({ parent_id: id }).toArray();
        });
    }
    confirmHscode() {
        return __awaiter(this, void 0, void 0, function* () {
            const finalCode = this.currentNode ? Object.assign({}, this.currentNode) : null;
            this.state = "general";
            this.currentNode = null;
            this.currentResults = [];
            return finalCode;
        });
    }
    processAssistantResponse(response) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (response.tool_calls && ((_a = response.tool_calls[0]) === null || _a === void 0 ? void 0 : _a.type) === 'function') {
                const functionName = response.tool_calls[0].function.name;
                const functionArgs = JSON.parse(response.tool_calls[0].function.arguments);
                if (this.funcDict[functionName]) {
                    const result = yield this.funcDict[functionName](...Object.values(functionArgs));
                    if (result) {
                        this.currentResults = result;
                        if (functionName === 'query_by_description') {
                            this.state = "parse_db";
                            return this.parseDbState(result);
                        }
                        else if (functionName === 'get_next') {
                            this.currentNode = Array.isArray(result) ? result[0] : result;
                            return this.parseDbState(result);
                        }
                        else if (functionName === 'confirm_hscode') {
                            return result;
                        }
                    }
                }
            }
            return response.content || '';
        });
    }
    parseDbState(results) {
        return __awaiter(this, void 0, void 0, function* () {
            this.state = "traverse";
            if (results && results.length > 0) {
                this.currentNode = results[0];
            }
            return results;
        });
    }
    runAssistantWithState(userInput, systemPrompt) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield this.openai.chat.completions.create({
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
            }
            catch (error) {
                console.error('Assistant interaction failed:', error);
                throw error;
            }
        });
    }
    getSystemPromptForState() {
        const prompts = {
            general: "You are an assistant for Indonesian customs. Help classify HS codes through tree traversal. " +
                "Translate the user's product description to English if necessary, then call query_by_description. " +
                "Format function calls as:\nFunction call: query_by_description\nArguments: {\"user_query\": \"translated description\"}",
            parse_db: "Present the search results in the user's language. Explain each option's relevance to their product. " +
                "Help them select the most appropriate category by asking clarifying questions. " +
                "If they've provided information that can eliminate some choices, do so.",
            traverse: "Navigate through HS code categories. If the user confirms the current category, format as:\n" +
                "Function call: confirm_hscode\nArguments: {}\n\n" +
                "If they want to explore subcategories, get the id_ field of the best matching option and format as:\n" +
                "Function call: get_next\nArguments: {\"id_\": chosen_id}\n\n" +
                "Always explain available subcategories before asking for their choice."
        };
        return prompts[this.state];
    }
    run(userInput) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Running FSM in state: ${this.state}`);
            const systemPrompt = this.getSystemPromptForState();
            const response = yield this.runAssistantWithState(userInput, systemPrompt);
            return this.processAssistantResponse(response);
        });
    }
}
exports.HSCodeFSM = HSCodeFSM;
exports.default = HSCodeFSM;
