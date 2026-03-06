import os
import json
import csv

def merge_json_to_csv(input_folder, output_filename):
    # Define the columns (headers) for the output CSV
    headers = [
        "anonim_nev", 
        "kitoltes_szama", 
        "korcsoport", 
        "neme",             
        "jogositvany_kora", 
        "experiment_start_time",
        "block_name", 
        "question_text", 
        "active_rule_name",           # UPDATED: Tells you which rule was active (e.g., 'left_hand_rule')
        "user_answer", 
        "expected_answer", 
        "original_baseline_answer",   # UPDATED: The old habit
        "is_correct", 
        "is_perseveration_error", 
        "reaction_time_ms", 
        "timestamp"
    ]

    # Check if the data folder actually exists
    if not os.path.exists(input_folder):
        print(f"Hiba: A '{input_folder}' mappa nem létezik a jelenlegi könyvtárban.")
        print("Kérlek hozd létre a 'data' mappát, és tedd bele a JSON fájlokat!")
        return

    # Find all JSON files in the data folder
    json_files = [f for f in os.listdir(input_folder) if f.endswith('.json')]
    
    if not json_files:
        print(f"Nem találtam .json fájlokat a '{input_folder}' mappában.")
        return

    # Open the CSV file for writing (UTF-8 encoding with BOM for Excel compatibility)
    with open(output_filename, mode='w', newline='', encoding='utf-8-sig') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=headers, extrasaction='ignore')
        
        # Write the header row
        writer.writeheader()
        
        row_count = 0
        file_count = 0
        
        # Process each file
        for file in json_files:
            file_path = os.path.join(input_folder, file)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as jf:
                    data = json.load(jf)
                    
                    user_data = data.get("user", {})
                    logs = data.get("logs", [])
                    
                    # Each question-answer log becomes a new row in the CSV
                    for log in logs:
                        # Merge user data and log data into a single dictionary
                        row = {**user_data, **log}
                        writer.writerow(row)
                        row_count += 1
                        
                file_count += 1
                print(f"Feldolgozva: {file}")
                
            except Exception as e:
                print(f"Hiba a {file} feldolgozása közben: {e}")

    print("-" * 30)
    print(f"KÉSZ! {file_count} fájl egyesítve.")
    print(f"Összesen {row_count} sor került a '{output_filename}' fájlba.")

if __name__ == "__main__":
    # Point the script to the new "data" folder
    INPUT_FOLDER = "data" 
    OUTPUT_FILE = "osszesitett_kresz_adatok.csv"
    
    merge_json_to_csv(INPUT_FOLDER, OUTPUT_FILE)