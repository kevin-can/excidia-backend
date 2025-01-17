"use strict";
async function getVectorStoreDetails(vectorStoreId) {
    try {
        const details = await openai.beta.vectorStores.retrieve(vectorStoreId);
        console.log("Vector Store Details:", details);
    }
    catch (error) {
        console.error("Error fetching vector store details:", error);
    }
}
const vectorStoreId = "vs_cX8e0hQwHmLtA3UX3rOalGLW"; // Replace with your vector store ID
getVectorStoreDetails(vectorStoreId);
