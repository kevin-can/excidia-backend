import fs from "fs";
import path from "path";
import OpenAI from "openai";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Configure dotenv to look in the correct location
dotenv.config({ path: path.join(__dirname, '../../.env') });


// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Use the API key from .env
});


// Function to create an assistant
async function createAssistant() {
    try {
      const assistant = await openai.beta.assistants.create({
        name: "Indonesia HS Code Finder",
        instructions: `
  You are a HS code classifier. In your knowledge base, I have uploaded a file called BTKI-2022.xlsm. When the user is asking about HS codes, always assume that they mean for the country of Indonesia and no other country. You must only use this file as your source of answers, which contains all the HS codes in Indonesia, so do not search the web or try to assist for any other country. 
  
  If the user asks about another country, reply kindly that your services only offer help for Indonesia.
  
  If HS code classification is required, you must extract a specific product description from the user's broader query or paragraph. For example:
  - If the query is, "Help me import electronics," refine the query to specific items such as "mobile phones" or "television sets."
  - If the user says, "I want to import shrimp," ask for more details such as:
      - **Form**: Is the shrimp fresh, frozen, cooked, dried, or preserved?
      - **Preparation**: Is it peeled, deveined, or whole?
      - **Packaging**: Are there specific packaging details like bulk or retail?
      - **Species**: If known, is it a specific type of shrimp (e.g., prawn, tiger shrimp)?
      - **Intended Use**: Is it for human consumption, bait, or another purpose?
  
  After identifying the 4-digit HS code, you must:
  1. Ask for confirmation from the user.
  2. Offer suggestions to narrow down the specifics for identifying the next 2 digits.
  3. Repeat this process to help refine the final 10-digit HS code.
  
  **Important**:
  - Continue asking questions and providing suggestions until the full 10-digit HS code is found.
  - Once the 10-digit code is confirmed, prepend the code to your final message in this format: "1509074 {actual GPT response here}"
  
  Here is an example conversation:
  ---
  User: “I want to import shrimp”
  GPT: “Could you provide more details about the shrimp you intend to import? Specifically:
  Form: Is the shrimp fresh, frozen, cooked, dried, or preserved?
  Preparation: Is it peeled, deveined, or whole?
  Packaging: Are there specific packaging details like bulk or retail?
  Species: If known, is it a specific type of shrimp (e.g., prawn, tiger shrimp)?
  Intended Use: Is it for human consumption, bait, or another purpose?
  These details will help refine the HS code classification. Let me know!”
  ---
  Never stop asking questions or giving suggestions until the 10-digit HS code is confirmed. Ensure the user receives sufficient options and guidance for each level of specificity (4-digit, 6-digit, and 10-digit). 
  
  **Critical Note**:
  If you respond like this:
  User: "Udang sudah dikupas"
  GPT: "Kode HS untuk udang segar yang sudah dikupas adalah 0306.95."
  This is incorrect because the GPT prematurely stopped asking questions and providing suggestions before reaching the full 10-digit code. Make sure this never happens.
  `,
        model: "gpt-4o",
        tools: [{ type: "file_search" }],
      });
  
      console.log("Assistant created successfully:", assistant);
      return assistant;
    } catch (error) {
      console.error("Error creating assistant:", error);
    }
  }
  

// Helper function to get all files from directories
async function getAllFilesFromDirectories(directories) {
  let filePaths = [];
  for (const directory of directories) {
    console.log(`Reading files from directory: ${directory}`);
    const files = fs.readdirSync(directory, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(directory, file.name);
      if (file.isFile()) filePaths.push(fullPath);
    }
  }
  return filePaths;
}

// Function to upload files to a vector store
async function uploadFilesToVectorStore(directories, batchSize) {
  try {
    const filePaths = await getAllFilesFromDirectories(directories);
    console.log(`Found ${filePaths.length} files to upload.`);

    if (filePaths.length === 0) {
      console.error("No files found in the specified directories.");
      return;
    }

    const vectorStore = await openai.beta.vectorStores.create({
      name: "Indonesia HS Code Knowledge Base",
    });
    console.log("Vector Store created with ID:", vectorStore.id);

    for (let i = 0; i < filePaths.length; i += batchSize) {
      // Ensure valid streams are created
      const batch = filePaths.slice(i, i + batchSize).map((filePath) => {
        try {
          // Check if the file exists and is readable
          if (fs.existsSync(filePath)) {
            return fs.createReadStream(filePath);
          } else {
            console.error(`File does not exist: ${filePath}`);
            return null;
          }
        } catch (error) {
          console.error(`Error accessing file: ${filePath}`, error);
          return null;
        }
      }).filter((stream) => stream !== null); // Remove invalid streams

      if (batch.length === 0) {
        console.error(`Batch ${Math.floor(i / batchSize) + 1} is empty. Skipping.`);
        continue;
      }

      console.log(`Uploading batch ${Math.floor(i / batchSize) + 1} with ${batch.length} files...`);

      try {
        await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, batch);
        console.log(`Batch ${Math.floor(i / batchSize) + 1} uploaded successfully.`);
      } catch (batchError) {
        console.error(`Error uploading batch ${Math.floor(i / batchSize) + 1}:`, batchError);
      }
    }

    console.log("All files uploaded successfully to the vector store.");
  } catch (error) {
    console.error("Error during file upload process:", error);
    throw error;
  }
}


// Main function to test the workflow
async function main() {
  try {
    console.log("Step 1: Creating assistant...");
    await createAssistant();

    console.log("Step 2: Uploading files...");
    const directories = ["ten_digit", "six_digit"]; // Adjust paths as needed
    const batchSize = 20; // Adjust batch size based on file size and number of files
    await uploadFilesToVectorStore(directories, batchSize);

    console.log("Test completed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

main();