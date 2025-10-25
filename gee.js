// gee.js
import { JWT } from "google-auth-library";
import { readFileSync } from "fs";
import { GoogleAuth } from "google-auth-library";
import ee from "@google/earthengine";

const privateKey = JSON.parse(readFileSync("private-key.json"));

const authClient = new JWT({
  email: privateKey.client_email,
  key: privateKey.private_key,
  scopes: ["https://www.googleapis.com/auth/earthengine.readonly"],
});

export async function authenticateEE() {
  const token = await authClient.authorize();
  ee.data.authenticateViaPrivateKey(
    privateKey,
    () => {
      ee.initialize(
        null,
        null,
        () => {
          console.log("Earth Engine inicializado com sucesso, use");
        },
        (err) => {
          console.error("Erro ao inicializar Earth Engine:", err);
        }
      );
    },
    (err) => {
      console.error("Erro na autenticação Earth Engine:", err);
    }
  );
}

export { ee };
