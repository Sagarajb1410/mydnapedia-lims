// Dummy cases for the short client report (made-up people and results).
// Row: [section, group, name, level 0/1/2, result text]. Run: node test/fixtures/short-report/make.js
const fs = require('node:fs');
const path = require('node:path');
const R = (section, group, list) => list.map(([name, level, result]) => ({ section, group, name, level, result: result || '' }));
const kase = (patient, life, rows) => ({ app: 'mdp-report-studio-case', version: 1, patient, clinical: { rows, details: {} }, form: { life } });

const fitness = kase({ name: 'Ananya Dummy', sampleId: 'MDP00020269901', gender: 'Female', age: 34, reportDate: '20 Aug 2026' }, { diet: 'Vegetarian' }, [
  ...R('trait', 'Sports, Exercise and Recovery', [
    ['Muscle Performance', 0, 'Proportionate balance of fast- and slow-twitch muscle fibers. Equal potential for good performance in power and endurance sports.'],
    ['Sleep Duration', 0, 'Likely to have normal sleep duration'], ['Sleep Depth', 0, 'Less likely to have deep sleep'],
    ['Detox Capacity', 1, 'Likely to have reduced detox capacity'], ['VO2 Max', 0, 'You may have a normal VO2 max potential.'],
    ['Muscle Fatigue', 1, 'You may be slightly susceptible to early muscle fatigue.'], ['Injury Management', 0, 'Lower obesity risk supports healthier joints.'],
    ['Exercise time', 1, 'You maybe slightly susceptible to higher muscle fatigue, morning exercise may reduce strain.'], ['Motivation to Exercise', 0, 'Normal motivation to exercise']]),
  ...R('trait', 'Injury risk and Inflammation', [
    ['Sports Injury - Anterior Cruciate Ligament (ACL) rupture', 0, 'Typical likelihood for sports-induced injury.'],
    ['Disc Degeneration', 2, 'Increased risk for high interleukin levels and disc degeneration'],
    ['Inflammation (autoimmune risk)', 1, 'Slightly increased genetic risk for chronic inflammation and autoimmune disease.']]),
  ...R('trait', 'Micro Nutrients', [['Vitamin B6', 2], ['Vitamin B9', 0], ['Vitamin D', 1], ['Vitamin C', 0], ['Vitamin A', 1], ['Iron', 1], ['Magnesium', 0], ['Biotin', 0], ['Calcium', 1], ['Vitamin B12', 1]]),
  ...R('trait', 'Weight Management', [['Appetite and Eating Behavior', 0], ['Protein Requirement', 0, 'Very likely to have higher protein requirement'], ['Dietary fiber', 0, 'Likely weight loss with a high fiber intake'],
    ['Healthy Fats', 1], ['Obesity', 0], ['Weight Loss', 2, 'Increased risk for weight-loss resistance and rebound weight gain'], ['Meal frequency', 0, 'likely to have a better appetite control, leading less frequent meals.']]),
  ...R('trait', 'Mental Fitness', [['Memory', 0, 'Very likely to have exceptional memory'], ['Learning Capacity', 0, 'Likely to be very good at feedback-based learning'], ['Resilience', 0, 'Resiliant to stressful situations'],
    ['Caffeine Addiction', 1], ['Nicotine Addiction', 2], ['Alcohol Addiction', 1], ['Circadian rhythm', 0, 'You are slightly likely to have delay in the body clock, disrupting sleep and increasing nighttime hunger.']]),
  ...R('trait', 'Health Monitor', [['Bone Mineral Density', 0], ['Low Density Cholesterol Levels (LDL)', 1], ['High Density Cholesterol Levels (HDL)', 0], ['Blood Pressure', 1]]),
  ...R('trait', 'Allergies and Sensitivities', [['Dietary Fat Sensitivity', 0], ['Carbohydrate Sensitivity', 0], ['Peanut Allergy', 1], ['Lactose Intolerance', 2]]),
  ...R('disease', 'Cardiac Health', [['Coronary Heart Disease', 0], ['Hypertrophic Cardiomyopathy', 0], ['Sudden Cardiac Arrest', 0], ['Atrial Fibrillation', 1], ['Long QT Interval', 0], ['Stroke', 0], ['Type 2 Diabetes', 0]]),
  ...R('disease', 'Disease Risk', [['Venous Thromboembolism', 0], ['Restless Legs Syndrome', 0], ['Ankylosing Spondylitis', 0], ['Migraine', 0], ['Chronic Kidney Disease', 0], ['Liver Cirrhosis', 1], ['Hypothyroidism', 0], ['Gluten Intolerance', 2]]),
]);

const cardiac = kase({ name: 'Rakesh Dummy', sampleId: 'MDP00020269902', gender: 'Male', age: 48, reportDate: '20 Jun 2026' }, { diet: 'Non-veg' }, [
  ...R('trait', 'Risk Factors', [['Blood Pressure', 2], ['High Density Cholesterol Levels (HDL)', 0], ['Low Density Cholesterol Levels (LDL)', 1], ['Triglycerides', 1], ['Homocysteine levels', 0], ['Magnesium', 0], ['Iron', 1]]),
  ...R('trait', 'Weight Management', [['Appetite and Eating Behavior', 0], ['Obesity', 1], ['Weight Loss', 1]]),
  ...R('trait', 'Habits and Addictions', [['Sleep Depth', 0], ['Sleep Duration', 0], ['Nicotine Addiction', 1], ['Alcohol Addiction', 2]]),
  ...R('trait', 'Exercise and Recovery', [['Muscle Performance', 0, 'Greater proportion of slow-twitch muscle fibers. Enhanced performance in endurance-based sports and activities.'], ['Sports Injury - Anterior Cruciate Ligament (ACL) rupture', 0], ['Detox Capacity', 1]]),
  ...R('disease', 'Cardiovascular', [['Atrial Fibrillation', 0], ['Coronary Heart Disease', 2], ['Stroke', 1], ['Hypertrophic Cardiomyopathy', 0], ['Venous Thromboembolism', 0], ['Sudden Cardiac Arrest', 0], ['Long QT Interval', 1]]),
  ...R('disease', 'Diabetes and Thyroid', [['Type 1 Diabetes', 0], ['Type 2 Diabetes', 0], ['Hypothyroidism', 0]]),
  ...R('drug', '', [['Simvastatin', 0, 'Baseline risk for statin-related myopathy'], ['Atorvastatin', 0, 'Baseline risk'], ['Propranolol', 1, 'Slightly high genetic risk for decreased drug response'],
    ['Carvedilol', 0, 'Normal metabolizer'], ['Metoprolol', 0, 'Normal metabolizer'], ['Warfarin', 0, 'Baseline risk for drug-induced bleeding'], ['Acenocoumarol', 0], ['Phenprocoumon', 0],
    ['Clopidogrel', 1, 'Intermediate metabolizer. Alternate therapy may be required.'], ['Isosorbide and Hydralazine (BIDIL)', 2, 'Slow acetylator. High risk for drug-induced side effects or toxicity.'],
    ['Propafenone', 0], ['Metformin', 2, 'High likelihood for decreased drug response.'], ['Glimeperide', 0], ['Glipizide', 0], ['Glyburide', 0], ['Chlorpropamide', 0], ['Rosuvastatin', 0], ['Ticagrelor', 0], ['Prasugrel', 0]]),
]);

const p360 = kase({ name: 'Meera Dummy', sampleId: 'MDP00020269903', gender: 'Female', age: 41, reportDate: '05 Nov 2026' }, { diet: 'Eggetarian' }, [
  ...R('trait', 'Longevity Essentials', [['Healthy Aging', 0, 'Very likely to have better health, leading to a longer life span'], ['Osteoporosis', 1]]),
  ...R('trait', 'Nutrition', [['Vitamin D', 2], ['Vitamin C', 0], ['Vitamin B6', 0], ['Vitamin B9', 1], ['Vitamin B12', 1], ['Healthy Fats (PUFA)', 1]]),
  ...R('trait', 'Skin and Hair', [['Eyebrow Thickness', 0], ['Teenage Acne', 0], ['Sun burns', 1], ['Tanning', 0], ['Freckling', 0]]),
  ...R('trait', 'Lifestyle', [['Sleep Duration', 0], ['Sleep Cycle', 0], ['Sleep Depth', 1], ['High Altitude Adaptation', 0], ['Nicotine Addiction', 0], ['Alcohol Addiction', 0], ['Alcohol Flush Reaction', 0], ['Caffeine Addiction', 1], ['Obesity', 2], ['Detox Capacity', 0], ['Dietary Fat Sensitivity', 1]]),
  ...R('trait', 'Behavioural', [['Resilience (Personality)', 1], ['Learning Capacity', 0], ['Memory', 0]]),
  ...R('trait', 'Cardiovascular', [['Low Density Cholesterol (LDL)', 2], ['High Density Cholesterol (HDL)', 1], ['Homocysteine levels', 0], ['Blood Pressure', 0], ['Triglycerides', 1]]),
  ...R('trait', 'Food Allergies', [['Peanut Allergy', 0], ['Lactose Intolerance', 1]]),
  ...R('trait', 'Micro Nutrients', [['Zinc levels', 0], ['Magnesium', 0], ['Iron', 2], ['Iron Overload', 0]]),
  ...R('trait', 'Sports', [['Motivation to Exercise', 1], ['VO2 Max', 0], ['Muscle Performance', 0, 'Greater proportion of fast-twitch muscle fibers. Enhanced performance in power sports.'], ['Bone Mineral Density', 0]]),
  ...R('disease', 'Cardiovascular Diseases', [['Atrial Fibrillation', 0], ['Coronary Heart Disease', 1], ['Stroke', 0], ['Long QT', 0], ['Hypertrophic Cardiomyopathy', 0], ['Venous Thromboembolism', 0], ['Sudden Cardiac Arrest', 0]]),
  ...R('disease', 'Endocrine', [['Type 1 Diabetes', 0], ['Type 2 Diabetes', 2], ['Hypothyroidism', 1]]),
  ...R('disease', 'Cancer', [['Colorectal cancer', 0], ['Lung Cancer', 0], ['Pancreatic Cancer', 0], ['Bladder cancer', 0], ['Melanoma', 0], ['Renal Cell Carcinoma', 0], ['Basal Cell Carcinoma', 0], ['Follicular Lymphoma', 0], ['Chronic Lymphocytic Leukemia', 0], ['Hodgkins Lymphoma', 0], ['Thyroid Cancer', 1], ['Prostate Cancer', 0], ['Testicular Cancer', 0]]),
  ...R('disease', 'Liver, Gastro and Renal', [['Celiac Disease', 0], ['Biliary Cirrhosis', 0], ['Chronic Kidney Disease', 0], ["Crohn's Disease", 0], ['Ulcerative Colitis', 0], ['Gallstones', 1]]),
  ...R('disease', 'Neuro and Psychiatry', [["Parkinson's", 0], ['Multiple Sclerosis', 0], ['Schizophrenia', 0], ["Alzheimer's", 1], ['Bipolar Disorder', 0], ['Migraine', 1], ['Amyotrophic Lateral Sclerosis', 0], ['Restless Legs Syndrome', 0]]),
  ...R('disease', 'Inflammatory', [['Ankylosing Spondylitis', 0], ['Rheumatoid Arthritis', 0], ['Asthma', 0], ['Systemic Lupus Erythematosus', 0]]),
  ...R('disease', 'Eyes, Skin and Hair', [['Age Related Macular Degeneration', 0], ['Atopic Dermatitis', 0], ['Psoriasis', 0], ['Vitiligo', 0], ['Male Pattern Baldness', 0]]),
  ...R('carrier', 'Carrier Status', [['Glucose-6-Phosphate (G6PD) Deficiency', 0], ['Phenylketonuria', 0], ['Beta Thalassemia', 1], ['Cystic Fibrosis', 0], ['Sickle Cell Anaemia', 0]]),
  ...R('drug', '', [['Clopidogrel', 0, 'Normal metabolizer'], ['Warfarin', 1, 'Increased risk for drug-induced bleeding. Lower dose may be required.'], ['Simvastatin', 0], ['Omeprazole', 0], ['Codeine', 2, 'Poor metabolizer. Reduced response and risk of side effects.'], ['Tamoxifen', 0], ['Metformin', 0]]),
]);

const skin = kase({ name: 'Kavya Dummy', sampleId: 'MDP00020269904', gender: 'Female', age: 29, reportDate: '02 Nov 2026' }, { diet: 'Vegan' }, [
  ...R('trait', 'Skin Texture and Aging', [['Collagen Quality', 2], ['Skin Elasticity', 1], ['Wrinkles', 1], ['Glycation', 1], ['Stretch Marks', 0], ['Cellulite', 0], ['Skin Hydration', 1]]),
  ...R('trait', 'Skin Damage', [['Sun burns', 2], ['Tanning', 1], ['Freckling', 0], ['Pigmentation', 2], ['Antioxidant Capacity', 1]]),
  ...R('trait', 'Hair Care', [['Hair Loss', 1], ['Premature Greying', 0], ['Dandruff', 0]]),
  ...R('trait', 'Skin Nutrition', [['Vitamin A', 0], ['Vitamin C', 1], ['Vitamin E', 0], ['Vitamin D', 1], ['Healthy Fats', 1], ['Zinc levels', 0], ['Biotin', 0]]),
  ...R('trait', 'Skin Inflammation', [['Teenage Acne', 1], ['Rosacea', 0], ['Atopic Dermatitis', 0], ['Psoriasis', 0], ['Vitiligo', 0], ['Skin Sensitivity', 1]]),
]);

const out = __dirname;
for (const [name, c] of [['fitness', fitness], ['cardiac', cardiac], ['360', p360], ['skin', skin]]) fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(c, null, 1)}\n`);
