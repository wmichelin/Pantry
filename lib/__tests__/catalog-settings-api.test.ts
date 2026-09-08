import { expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import * as p from "../gen/pantry/v1/catalog_settings_pb";
import { catalogSettingsAPI, stagingCatalogSettingsAPIOrigin, aisleView, settingsView } from "../catalog-settings-api";

it("keeps catalog/settings independently disabled by default", () => expect(stagingCatalogSettingsAPIOrigin()).toBeNull());
it("maps all binary operations with caller scope and optional zero intact", async () => {
 const methods: string[] = [];
 const item = {id:"i",normalizedName:"flour",displayName:"",sortOrder:0,category:" "};
 const view = {revision:"exact-loaded-revision",aisles:[{key:"other",label:"Other",sortOrder:0}]};
 const settings = {household:{id:"h",name:"Home",inviteCode:"invite"},members:[{id:"m",displayName:"Member",role:"member"}],stores:[{id:"s",name:"Shop",sortOrder:0}]};
 const client = catalogSettingsAPI("https://example.com","caller",async (url,init) => {
  const name=String(url).split("/").pop()!;methods.push(name);
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer caller");
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
  const bytes=new Uint8Array(await new Response(init?.body).arrayBuffer());
  let response: Uint8Array;
  const binary = <T extends Parameters<typeof toBinary>[0]>(schema:T,value:Parameters<typeof create<T>>[1]) => toBinary(schema,create(schema,value));
  switch(name){
   case "GetCatalog": expect(fromBinary(p.GetCatalogRequestSchema,bytes).householdId).toBe("h");response=binary(p.GetCatalogResponseSchema,{items:[item]});break;
   case "EnsureCatalogIngredient": {
    const r=fromBinary(p.EnsureCatalogIngredientRequestSchema,bytes);expect(r.householdId).toBe("h");expect(r.rawName).toBe("2 cups flour");
    expect(r.sortOrder).toBe(0);expect(r.displayName).toBe("");expect(r.category).toBeUndefined();response=binary(p.EnsureCatalogIngredientResponseSchema,{item});break;
   }
   case "SeedCatalogFromRecipes": expect(fromBinary(p.SeedCatalogFromRecipesRequestSchema,bytes).householdId).toBe("h");response=binary(p.SeedCatalogFromRecipesResponseSchema,{added:2});break;
   case "UpdateCatalogIngredient": {
    const r=fromBinary(p.UpdateCatalogIngredientRequestSchema,bytes);expect([r.householdId,r.ingredientId,r.displayName,r.category]).toEqual(["h","i","Flour","custom"]);response=binary(p.UpdateCatalogIngredientResponseSchema,{item});break;
   }
   case "RemoveCatalogIngredient": expect(fromBinary(p.RemoveCatalogIngredientRequestSchema,bytes).ingredientId).toBe("i");response=new Uint8Array();break;
   case "GetHouseholdAisles": expect(fromBinary(p.GetHouseholdAislesRequestSchema,bytes).householdId).toBe("h");response=binary(p.GetHouseholdAislesResponseSchema,{view});break;
   case "CreateHouseholdAisle": expect(fromBinary(p.CreateHouseholdAisleRequestSchema,bytes).label).toBe("Wine");response=binary(p.CreateHouseholdAisleResponseSchema,{view});break;
   case "RemoveHouseholdAisle": expect(fromBinary(p.RemoveHouseholdAisleRequestSchema,bytes).key).toBe("wine");response=binary(p.RemoveHouseholdAisleResponseSchema,{view});break;
   case "SaveHouseholdAisleOrder": {const r=fromBinary(p.SaveHouseholdAisleOrderRequestSchema,bytes);expect(r.revision).toBe(view.revision);expect(r.keys).toEqual(["wine","other"]);response=binary(p.SaveHouseholdAisleOrderResponseSchema,{view});break;}
   case "GetHouseholdSettings": expect(fromBinary(p.GetHouseholdSettingsRequestSchema,bytes).householdId).toBe("h");response=binary(p.GetHouseholdSettingsResponseSchema,{settings});break;
   case "AddHouseholdStore": expect(fromBinary(p.AddHouseholdStoreRequestSchema,bytes).name).toBe("Shop");response=binary(p.AddHouseholdStoreResponseSchema,{settings});break;
   case "RemoveHouseholdStore": expect(fromBinary(p.RemoveHouseholdStoreRequestSchema,bytes).storeId).toBe("s");response=binary(p.RemoveHouseholdStoreResponseSchema,{settings});break;
   default: throw new Error("Unexpected operation");
  }
  return new Response(new Uint8Array(response),{headers:{"Content-Type":"application/proto"}});
 });
 const expected={id:"i",normalized_name:"flour",display_name:"",sort_order:0,category:"other"};
 expect(await client.catalog("h")).toEqual([expected]);
 expect(await client.ensure("h","2 cups flour",{sortOrder:0,displayName:""})).toEqual(expected);
 expect(await client.seed("h")).toBe(2);expect(await client.update("h","i","Flour","custom")).toEqual(expected);await client.removeIngredient("h","i");
 for (const v of [await client.aisles("h"),await client.addAisle("h","Wine"),await client.removeAisle("h","wine"),await client.orderAisles("h",view.revision,["wine","other"])]) expect(v).toEqual({revision:view.revision,aisles:[{id:"other",label:"Other",pitch:0}]});
 for (const v of [await client.settings("h"),await client.addStore("h","Shop"),await client.removeStore("h","s")]) expect(v).toEqual({household:{id:"h",name:"Home",invite_code:"invite"},members:[{id:"m",display_name:"Member",role:"member"}],stores:[{id:"s",name:"Shop",sort_order:0}]});
 expect(methods.length).toBe(12);
});
it("surfaces every failure safely without an extra fallback request",async()=>{
 let calls=0;const c=catalogSettingsAPI("https://example.com","caller",async()=>{calls++;return new Response("private detail",{status:503});});
 for (const op of [()=>c.catalog("h"),()=>c.ensure("h","x"),()=>c.seed("h"),()=>c.update("h","i","x","other"),()=>c.removeIngredient("h","i"),()=>c.aisles("h"),()=>c.addAisle("h","x"),()=>c.removeAisle("h","x"),()=>c.orderAisles("h","r",["other"]),()=>c.settings("h"),()=>c.addStore("h","x"),()=>c.removeStore("h","s")]) await expect(op()).rejects.toThrow("Pantry could not");
 expect(calls).toBe(12);
});
it("distinguishes intentional no ingredient from missing required snapshots",async()=>{
 const c=catalogSettingsAPI("https://example.com","caller",async()=>new Response(new Uint8Array(),{headers:{"Content-Type":"application/proto"}}));
 expect(await c.ensure("h","For sauce:")).toBeNull();
 await expect(c.update("h","i","x","other")).rejects.toThrow();
 await expect(c.aisles("h")).rejects.toThrow();await expect(c.settings("h")).rejects.toThrow();
 expect(()=>aisleView(undefined)).toThrow();expect(()=>settingsView(undefined)).toThrow();
});
