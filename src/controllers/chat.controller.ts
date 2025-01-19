import { Request, Response } from 'express';
import HSCodeFSM from '../services/hsCodeFSM.service.js';
import { hsDb } from '../config/database.js';

// Define interfaces for type safety
interface HSCode {
    description: string;
    indonesian_description: string;
    hs_code: string;
    id_: number;
    parent_id: number;
    depth: number;
    is_leaf: boolean;
}

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface FSMStateObject {
    state: 'general' | 'parse_db' | 'traverse';
    currentResults: HSCode[];
    currentNode: HSCode | null;
}

interface ChatRequest {
    messages: ChatMessage[];
    stateObject?: FSMStateObject;
}

interface FSMResponse {
    message: string | HSCode[];
    stateObject: FSMStateObject;
}

interface APIResponse {
    response: string | HSCode[];
    stateObject: FSMStateObject;
}

interface ErrorResponse {
    error: string;
    details?: string;
}

// Create FSM instance
const fsm = new HSCodeFSM(hsDb);

export const generateResponse = async (
    req: Request<{}, {}, ChatRequest>,
    res: Response<APIResponse | ErrorResponse>
): Promise<void> => {
    try {
        const { messages, stateObject = {
            state: 'general',
            currentResults: [],
            currentNode: null
        }} = req.body;
        
        // Validate request
        if (!messages?.length) {
            res.status(400).json({ error: 'Messages are required' });
            return;
        }

        // Process through FSM
        const response: FSMResponse = await fsm.run({
            messages,
            stateObject
        });

        // Format response based on the type of message returned
        const formattedResponse: APIResponse = {
            response: response.message,
            stateObject: response.stateObject
        };

        // Send response
        res.json(formattedResponse);

    } catch (error) {
        // Detailed error logging
        console.error('Error generating response:', {
            name: error instanceof Error ? error.name : 'Unknown Error',
            message: error instanceof Error ? error.message : 'An unknown error occurred',
            stack: error instanceof Error ? error.stack : undefined,
            state: req.body.stateObject?.state
        });
        
        // Send error response
        res.status(500).json({
            error: 'Failed to generate response',
            details: error instanceof Error 
                ? error.message 
                : 'An unexpected error occurred while processing your request'
        });
    }
};