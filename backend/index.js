import express from "express";
import { tavily } from '@tavily/core';
import { GoogleGenAI } from "@google/genai";
import { PROMPT_TEMPLATE } from "./prompt";
import { z } from "zod";


const app = express();
app.use(express.json())
const ai = new GoogleGenAI({
    apiKey:process.env.GEMINI_API_KEY
});


const client = tavily({ apiKey: process.env.TAVILY_API_KEY});

app.get("/signup",(req,res)=>{

})

app.get("signin",(req,res)=>{

})

app.post("conversation",(res,req)=>{

})

app.post("conversation:conversationId",(req,res)=>{
    
})

app.post("/nova_ask", async (req, res) => {
    
    // 1. get the query from the user 
    const query = req.body.query;

    // 2. make sure user have access/credits to hit the endpoint

    // 3. check if we have web search indexed for similar query

    // 4. web search to gather sources
    const webSearchResponse = await client.search(query, {
    searchDepth: "advanced"
    })

    const WebSearchResult = webSearchResponse.results; 

    // 5. do some context enginnering on the prompt + web search response 

    // 6. hit the LLM and straem back the response 

    const prompt = PROMPT_TEMPLATE
    .replace("{{WEB_SEARCH_RESULTS}}",JSON.stringify(webSearchResponse))
    .replace("{{USER_QUERY}}",query)

     const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        systemInstruction: SYSTEM_PROMPT,
    });

    for await (const textPart of results.textStream){
        res.write(textPart)
    }

    res.write("\n<SOURCES>\n")

    // 7. stream back the sources 
    res.write(JSON.stringify(WebSearchResult.map(results => ({url : results.url }))))

    res.write("\n</SOURCES>\n")


    // 8. Close the Stream
    res.end()


});

app.post("/nova_ask_followup",(req,res)=>{
    // Step 1 : getting the existing chat from DB
    // Step 2 : forward full histriy to the LLM
    // Step 3 : Stream the response to teh user
})


app.listen(3000, () => {
    console.log("server is running");
});