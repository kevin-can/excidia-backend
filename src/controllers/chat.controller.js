// chat.controller.js
import { HSCodeFSM } from '../services/hsCodeFSM.service.js';  // Note: add .js extension and use named import
import { hsDb } from '../config/database.js';

// Create a single instance of FSM to maintain state
const fsm = new HSCodeFSM(hsDb);

export const generateResponse = async (req, res) => {
    try {
        const { messages } = req.body;
        
        if (!messages || !messages.length) {
            return res.status(400).json({ error: 'Messages are required' });
        }

        // Get the latest message
        const latestMessage = messages[messages.length - 1];
        
        // Process through FSM
        const response = await fsm.run(latestMessage.content);

        res.json({
            response: response,
            status: fsm.state
        });
    } catch (error) {
        console.error('Error generating response:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            error: 'Failed to generate response',
            details: error.message
        });
    }
};