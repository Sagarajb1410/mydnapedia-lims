// Plain-language meanings and result-specific advice for the short client
// report. Written by MyDNAPedia for clients with no science background: what
// the parameter is, what a green / yellow / red result means for them, and
// what they can do about it. Advice is shown only for results that need it,
// so a client reads steps for their own findings, not a common list.
//
// Every entry is ours: nothing here is copied from the partner's report.
// Foods follow the client's diet when the counselling form gives it.
//
// Entry fields:
//   area   where it sits in the report (see AREAS)
//   what   what it is, in one plain sentence
//   yes    what a yellow / red result means (high: stronger wording for red)
//   no     what a green result means
//   tips   steps for a flagged result, most useful first; a tip may be a
//          function of the diet ({ veg, egg, nonveg, vegan, any })
//   check  a blood test or check-up worth asking for when flagged
//   w      how much it matters when ordering steps (default 1)
//   sex    'M' or 'F' when it applies to one sex only
//   info   for descriptive traits: (result text) => a tip, shown under
//          "Good to know about you" whatever the colour
//   ok     shown under "Your strengths" when green and the result is favourable

const AREAS = {
  heart: 'Heart, sugar and blood pressure',
  weight: 'Weight and metabolism',
  food: 'Food and nutrients',
  allergy: 'Food sensitivities and allergies',
  fitness: 'Exercise and recovery',
  mind: 'Sleep, mind and mood',
  habits: 'Habits',
  skin: 'Skin and hair',
  health: 'Long-term health',
  carrier: 'Genes you could pass on',
};

const ENTRIES = [];
const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
function E(names, entry) { ENTRIES.push({ names: [].concat(names), name: [].concat(names)[0], w: 1, ...entry }); }

// Foods by diet. "any" is used when the diet is not known.
const F = (o) => (diet) => o[diet] || o.any;

// ---------- Nutrients ----------
function nutrient(names, what, foods, { check, extra, w = 1, label } = {}) {
  const n = (label || [].concat(names)[0]).replace(/\b([A-Z])([a-z]+)\b/g, (m) => m.toLowerCase());
  E(names, {
    area: 'food', what, w, check, foods,
    yes: `Your body may need more ${n} than most people, even on a normal diet.`,
    high: `Your body is very likely to need more ${n} than most people. Small daily habits close this gap.`,
    no: `A normal balanced diet is likely to give you enough ${n}.`,
    tips: [(diet) => `Eat ${n}-rich foods every day: ${foods(diet)}.`, ...(extra || []), check ? `Ask for a ${check} before taking any supplement.` : 'Take a supplement only if your doctor advises it.'],
  });
}

nutrient('Vitamin D', 'Vitamin D keeps bones strong and supports immunity. The body makes it from sunlight.',
  F({ veg: 'fortified milk, curd, paneer, sun-dried mushrooms', egg: 'egg yolks, fortified milk, curd, mushrooms', nonveg: 'egg yolks, fatty fish like salmon or sardines, fortified milk', vegan: 'fortified soy milk, sun-dried mushrooms, fortified cereals', any: 'egg yolks, fish, fortified milk, mushrooms' }),
  { check: 'Vitamin D (25-OH) blood test', extra: ['Get 15 to 20 minutes of morning sun on your arms and face most days.'], w: 1.5 });
nutrient('Vitamin C', 'Vitamin C protects cells, helps wounds heal and helps the body absorb iron.',
  F({ any: 'amla, guava, oranges, lemon, capsicum, tomatoes' }), { w: 0.8 });
nutrient('Vitamin B6', 'Vitamin B6 helps the body use food for energy and supports the brain and nerves.',
  F({ veg: 'chickpeas, bananas, potatoes, peanuts, whole grains', egg: 'eggs, chickpeas, bananas, whole grains', nonveg: 'chicken, fish, eggs, chickpeas, bananas', vegan: 'chickpeas, bananas, potatoes, peanuts, soya', any: 'chickpeas, bananas, whole grains, eggs or fish' }), { w: 0.9 });
nutrient(['Vitamin B9', 'Folate', 'Folic acid'], 'Folate (vitamin B9) helps make new blood cells and is important before and during pregnancy.',
  F({ any: 'green leafy vegetables, dals, rajma, chana, oranges, beetroot' }), { check: 'folate and homocysteine blood test', w: 1, label: 'Folate' });
nutrient('Vitamin B12', 'Vitamin B12 keeps nerves and blood healthy and fights tiredness.',
  F({ veg: 'milk, curd, paneer, buttermilk, fortified cereals', egg: 'eggs, milk, curd, paneer', nonveg: 'fish, chicken, eggs, milk and curd', vegan: 'fortified soy milk and fortified cereals (a supplement is often needed)', any: 'milk, curd, paneer, eggs or fish' }),
  { check: 'Vitamin B12 blood test', w: 1.5 });
nutrient('Vitamin A', 'Vitamin A supports eyesight, skin and immunity.',
  F({ any: 'carrots, sweet potato, pumpkin, papaya, mango, spinach' }), { w: 0.7 });
nutrient('Vitamin E', 'Vitamin E protects cells, including skin cells, from damage.',
  F({ any: 'almonds, sunflower seeds, peanuts, spinach' }), { w: 0.6 });
nutrient('Biotin', 'Biotin helps turn food into energy and supports hair, skin and nails.',
  F({ veg: 'nuts, seeds, sweet potato, mushrooms', egg: 'eggs (cooked), nuts, seeds, sweet potato', nonveg: 'eggs (cooked), nuts, seeds, sweet potato', any: 'nuts, seeds, sweet potato, cooked eggs' }), { w: 0.6 });
nutrient('Calcium', 'Calcium builds strong bones and teeth and helps muscles work.',
  F({ veg: 'milk, curd, paneer, ragi, sesame seeds, green leafy vegetables', egg: 'milk, curd, paneer, ragi, sesame seeds', nonveg: 'milk, curd, paneer, small fish with bones, ragi', vegan: 'ragi, sesame seeds, tofu, fortified soy milk, leafy greens', any: 'milk, curd, paneer, ragi, sesame seeds' }),
  { check: 'serum calcium and Vitamin D test', w: 1 });
nutrient(['Iron'], 'Iron carries oxygen in the blood. Low iron makes you tired and short of breath.',
  F({ veg: 'green leafy vegetables, rajma, chana, dates, jaggery in small amounts', egg: 'eggs, green leafy vegetables, rajma, chana', nonveg: 'lean meat, chicken, fish, eggs, leafy greens', vegan: 'leafy greens, rajma, chana, tofu, seeds', any: 'leafy greens, rajma, chana, eggs or lean meat' }),
  { check: 'CBC and ferritin blood test', extra: ['Have lemon or amla with iron-rich meals, and keep tea or coffee an hour away from them.'], w: 1.2 });
nutrient(['Magnesium'], 'Magnesium helps muscles and nerves relax and keeps the heartbeat steady.',
  F({ any: 'nuts, seeds, whole grains, bananas, green leafy vegetables, dark chocolate' }), { w: 0.8 });
nutrient(['Zinc', 'Zinc levels'], 'Zinc helps immunity, wound healing, skin and hair.',
  F({ veg: 'pumpkin seeds, chana, cashews, whole grains, dairy', egg: 'eggs, pumpkin seeds, chana, cashews', nonveg: 'chicken, eggs, seafood, pumpkin seeds', any: 'pumpkin seeds, chana, cashews, eggs' }), { w: 0.7 });
nutrient(['Healthy Fats', 'Healthy Fats (PUFA)', 'PUFA', 'Omega-3', 'Omega 3 Fatty Acids'], 'Healthy fats (omega-3) protect the heart, brain and skin. Some people convert plant fats into them less well.',
  F({ veg: 'walnuts, flaxseed, chia seeds, mustard oil', egg: 'omega-3 eggs, walnuts, flaxseed, chia seeds', nonveg: 'fatty fish (salmon, sardine, mackerel) twice a week, walnuts, flaxseed', vegan: 'walnuts, flaxseed, chia seeds (an algal-oil supplement is an option)', any: 'walnuts, flaxseed, chia seeds or fatty fish' }),
  { label: 'healthy fats', w: 1.2 });

E(['Protein Requirement', 'Protein'], {
  area: 'food', w: 0.9, what: 'How much protein your body needs to build and repair muscle.',
  yes: 'Your body may need more protein than the usual amount.', no: 'A normal amount of protein is likely to be enough for you.',
  tips: [F({ veg: 'Have a protein food at every meal: dal, paneer, curd, chana, soya, sprouts.', egg: 'Have a protein food at every meal: eggs, dal, paneer, curd, sprouts.', nonveg: 'Have a protein food at every meal: eggs, chicken, fish, dal, curd.', vegan: 'Have a protein food at every meal: dal, tofu, soya, chana, peanuts.', any: 'Have a protein food at every meal: dal, curd, paneer, eggs or chicken.' })],
  info: (r) => /higher protein/i.test(r) ? F({ veg: 'Your body likes more protein: add dal, paneer, curd, soya or sprouts to every meal.', nonveg: 'Your body likes more protein: add eggs, chicken, fish or dal to every meal.', any: 'Your body likes more protein: add dal, curd, paneer, eggs or chicken to every meal.' }) : null,
});
E(['Dietary fiber', 'Dietary fibre', 'Fiber'], {
  area: 'weight', w: 0.6, what: 'How your weight responds to fibre (whole grains, vegetables, fruit).',
  yes: 'Your weight may respond less to fibre alone.', no: 'Fibre is likely to help you control your weight.',
  tips: ['Fill half your plate with vegetables and choose whole grains and millets over maida.'],
  info: (r) => /weight loss with a high fib/i.test(r) ? 'Fibre works well for you: whole grains, millets, vegetables and fruit help you control weight.' : null,
});
E(['Meal frequency'], {
  area: 'weight', w: 0.4, what: 'Whether your appetite is better controlled with fewer or more frequent meals.',
  yes: 'You may feel hungry often between meals.', no: 'You are likely to control appetite well.',
  tips: ['Plan three meals and one or two small healthy snacks at fixed times.'],
  info: (r) => /less frequent/i.test(r) ? 'Fewer, well-planned meals suit your appetite: avoid grazing between meals.' : /more frequent|small.*meals/i.test(r) ? 'Small, regular meals suit your appetite better than two big ones.' : null,
});

// ---------- Weight ----------
E(['Obesity'], {
  area: 'weight', w: 1.5, what: 'Your genetic tendency to gain body fat.',
  yes: 'Your genes make it easier for you to gain weight than most people.', high: 'Your genes make weight gain much easier for you than for most people, so habits matter more.',
  no: 'Your genes do not push you towards weight gain.',
  tips: ['Keep fixed meal times and measured portions; avoid eating late at night.', 'Walk briskly or exercise for 30 to 45 minutes on most days.', 'Check your weight and waist once a month.'],
  check: 'weight, waist and BMI at every check-up',
});
E(['Weight Loss', 'Weight loss resistance'], {
  area: 'weight', w: 1.3, what: 'How easily you lose weight and keep it off.',
  yes: 'You may find it harder to lose weight and easier to regain it.', high: 'Losing weight and keeping it off is likely to be harder for you, so slow, steady changes work best.',
  no: 'You are likely to lose weight when you change diet and activity.',
  tips: ['Aim for slow loss (half a kilo a week) with changes you can keep up, not crash diets.', 'Add strength training twice a week to protect muscle while you lose fat.', 'After you reach your goal weight, keep the same habits to avoid regain.'],
});
E(['Appetite and Eating Behavior', 'Appetite and Eating Behaviour', 'Appetite'], {
  area: 'weight', w: 0.8, what: 'How full you feel after eating and how likely you are to snack.',
  yes: 'You may feel less full after meals and snack more often.', no: 'You are likely to feel full after meals and not snack much.',
  tips: ['Start meals with salad or soup and eat slowly; keep healthy snacks like fruit or roasted chana handy.'],
});
E(['Dietary Fat Sensitivity', 'Fat sensitivity'], {
  area: 'weight', w: 1, what: 'How quickly you gain weight on a high-fat diet.',
  yes: 'You may gain weight quickly on fatty food.', no: 'Fat in your food is unlikely to cause quick weight gain.',
  tips: ['Keep fried, creamy and buttery food to once a week; use 3 to 4 teaspoons of oil a day.'],
});
E(['Carbohydrate Sensitivity', 'Carbohydrate sensitivity'], {
  area: 'weight', w: 1, what: 'How your weight and sugar respond to starchy and sweet food.',
  yes: 'Rice, maida, sweets and sugary drinks may raise your weight and sugar more than in others.', no: 'You do not have a raised sensitivity to carbohydrates.',
  tips: ['Swap white rice and maida for millets, whole wheat and brown rice, and cut sugary drinks.'],
});
E(['Detox Capacity', 'Detoxification'], {
  area: 'food', w: 0.8, what: 'How well your body clears harmful substances such as smoke, pollution and processed-food chemicals.',
  yes: 'Your body may clear harmful substances more slowly.', no: 'Your body is likely to clear harmful substances well.',
  tips: ['Eat cabbage, cauliflower, broccoli and other green vegetables often, and drink enough water.', 'Avoid smoking, second-hand smoke and charred or deep-fried food.'],
});

// ---------- Heart ----------
E(['Low Density Cholesterol (LDL)', 'Low Density Cholesterol Levels (LDL)', 'LDL', 'LDL Cholesterol'], {
  area: 'heart', w: 2, what: 'LDL is the "bad" cholesterol that can block blood vessels.',
  yes: 'Your genes may raise your bad cholesterol (LDL).', high: 'Your genes are likely to raise your bad cholesterol (LDL), which affects heart health.',
  no: 'Your genes are not likely to raise your bad cholesterol.',
  tips: ['Cut ghee, butter, vanaspati, fried snacks and bakery items; use small amounts of mustard, groundnut or rice-bran oil.', 'Eat oats, dals, beans, nuts and vegetables daily; they lower LDL.', 'Exercise for 30 minutes on most days.'],
  check: 'lipid profile every year',
});
E(['High Density Cholesterol (HDL)', 'High Density Cholesterol Levels (HDL)', 'HDL', 'HDL Cholesterol'], {
  area: 'heart', w: 1.3, what: 'HDL is the "good" cholesterol that protects the heart.',
  yes: 'Your genes may keep your good cholesterol (HDL) on the low side.', no: 'Your genes are not likely to lower your good cholesterol.',
  tips: ['Regular aerobic exercise (brisk walking, cycling, swimming) is the best way to raise HDL.', 'Eat nuts and seeds daily and avoid smoking.'],
  check: 'lipid profile every year',
});
E(['Triglycerides', 'Triglyceride'], {
  area: 'heart', w: 1.5, what: 'Triglycerides are fats in the blood; high levels harm the heart and liver.',
  yes: 'Your genes may raise the fats (triglycerides) in your blood.', no: 'Your genes are not likely to raise your blood triglycerides.',
  tips: ['Cut sugar, sweets, sugary drinks, white rice and maida; these raise triglycerides fastest.', 'Limit alcohol, and exercise on most days.'],
  check: 'lipid profile every year',
});
E(['Blood Pressure', 'Hypertension'], {
  area: 'heart', w: 2, what: 'Blood pressure is the force of blood on your blood vessels. High pressure strains the heart.',
  yes: 'Your genes may raise your chance of high blood pressure.', high: 'Your genes clearly raise your chance of high blood pressure.',
  no: 'Your genes do not raise your chance of high blood pressure.',
  tips: ['Keep salt under one teaspoon a day: go easy on pickles, papad, namkeen and packaged food.', 'Check your blood pressure at home or a pharmacy every month.', 'Walk briskly for 30 minutes a day and keep a healthy weight.'],
  check: 'blood pressure check every month',
});
E(['Homocysteine levels', 'Homocysteine'], {
  area: 'heart', w: 1.2, what: 'Homocysteine is a substance in the blood; high levels are linked to heart and blood-vessel problems.',
  yes: 'Your genes may raise your homocysteine level.', no: 'Your genes are not likely to raise your homocysteine level.',
  tips: [F({ veg: 'Eat folate and B12 foods daily: leafy greens, dals, milk and curd.', nonveg: 'Eat folate and B12 foods daily: leafy greens, dals, eggs and fish.', any: 'Eat folate and B12 foods daily: leafy greens, dals, milk, curd or eggs.' })],
  check: 'homocysteine and B12 blood test',
});
const heartDisease = (names, what, extra = {}) => disease(names, what, { area: 'heart', w: 2, ...extra });

// ---------- Diseases ----------
function disease(names, what, { area = 'health', tips, check, w = 1.2, sex, plain } = {}) {
  const n = plain || [].concat(names)[0];
  E(names, {
    area, w, what, check, sex,
    yes: `Your genes slightly raise your chance of ${n}. This is not a diagnosis: most people with this result never get it.`,
    high: `Your genes raise your chance of ${n} more than for most people. This is not a diagnosis, but regular checks are worth it.`,
    no: `Your genes do not raise your chance of ${n}.`,
    tips: tips || ['Mention this result to your doctor at your yearly check-up.'],
  });
}

heartDisease(['Coronary Heart Disease', 'Coronary Artery Disease'], 'Narrowing of the blood vessels of the heart, which can lead to chest pain or a heart attack.', {
  plain: 'heart disease (blocked heart arteries)', check: 'ECG, lipid profile and HbA1c every year',
  tips: ['Do not smoke, and keep blood pressure, sugar and cholesterol in the normal range.', 'Exercise for 150 minutes a week and keep your waist below 90 cm (men) or 80 cm (women).', 'See a doctor at once for chest pain or breathlessness on effort.'],
});
heartDisease(['Stroke'], 'A stroke happens when blood supply to part of the brain is blocked or a vessel bursts.', {
  plain: 'stroke', check: 'blood pressure, sugar and lipid profile every year',
  tips: ['Keep blood pressure under control: it is the biggest cause of stroke.', 'Know the warning signs (face drooping, arm weakness, slurred speech) and get to hospital at once.'],
});
heartDisease(['Atrial Fibrillation'], 'An irregular, often fast heartbeat.', {
  plain: 'an irregular heartbeat (atrial fibrillation)', check: 'ECG at your yearly check-up', w: 1.4,
  tips: ['Limit alcohol and caffeine, and keep blood pressure and weight in check.', 'See a doctor if you feel palpitations, dizziness or breathlessness.'],
});
heartDisease(['Long QT', 'Long QT Interval'], 'A heart-rhythm condition seen on an ECG that can cause fainting.', {
  plain: 'a heart-rhythm problem (long QT)', check: 'ECG', w: 1.4,
  tips: ['Before starting any new medicine, tell the doctor about this result: some medicines affect heart rhythm.', 'See a doctor if you faint or feel palpitations.'],
});
heartDisease(['Hypertrophic Cardiomyopathy'], 'Thickening of the heart muscle.', {
  plain: 'thickened heart muscle (cardiomyopathy)', check: 'ECG and echocardiogram if advised', w: 1.4,
  tips: ['Ask your doctor whether you need an ECG or echo before very intense sport.'],
});
heartDisease(['Sudden Cardiac Arrest'], 'When the heart suddenly stops beating properly.', {
  plain: 'sudden cardiac arrest', check: 'ECG at your yearly check-up', w: 1.4,
  tips: ['Get an ECG done and tell your doctor about any fainting or palpitations.'],
});
heartDisease(['Venous Thromboembolism', 'Deep Vein Thrombosis'], 'Blood clots in the veins, usually of the legs.', {
  plain: 'blood clots in the veins', w: 1.1,
  tips: ['On long journeys, get up and walk or move your ankles every hour, and drink water.', 'Tell your doctor about this result before surgery or hormone pills.'],
});
disease(['Type 2 Diabetes'], 'Type 2 diabetes is high blood sugar, usually linked to weight and activity.', {
  area: 'heart', w: 1.8, plain: 'type 2 diabetes', check: 'fasting sugar and HbA1c every year',
  tips: ['Cut sugar, sweets and sugary drinks; choose millets and whole grains over white rice.', 'Walk for 10 to 15 minutes after main meals.'],
});
disease(['Type 1 Diabetes'], 'Type 1 diabetes is when the body stops making insulin, usually from a young age.', {
  area: 'heart', plain: 'type 1 diabetes', check: 'fasting sugar and HbA1c',
  tips: ['See a doctor for unusual thirst, frequent urination or weight loss without trying.'],
});
disease(['Hypothyroidism'], 'An underactive thyroid gland, which can cause tiredness and weight gain.', {
  plain: 'an underactive thyroid', check: 'thyroid test (TSH) every year',
  tips: ['Get a thyroid test (TSH) every year, sooner if you feel tired, cold or gain weight without reason.'],
});
disease(['Osteoporosis'], 'Weak, thin bones that break easily.', {
  plain: 'weak bones (osteoporosis)', check: 'Vitamin D test and, after 50, a bone density scan', w: 1.6,
  tips: ['Do weight-bearing exercise (walking, stairs, light weights) at least 3 times a week.', 'Eat calcium foods daily and get morning sunlight for vitamin D.'],
});
E(['Bone Mineral Density'], {
  area: 'health', w: 1.4, what: 'How strong and dense your bones are.',
  yes: 'Your genes may give you lower bone density.', no: 'Your genes are not likely to lower your bone density.',
  tips: ['Do weight-bearing exercise (walking, stairs, light weights) at least 3 times a week.', 'Eat calcium foods daily and get morning sunlight for vitamin D.'],
  check: 'Vitamin D test and, after 50, a bone density scan',
});
disease(['Chronic Kidney Disease'], 'Slow loss of kidney function over years.', {
  plain: 'kidney disease', check: 'creatinine and urine test every year',
  tips: ['Drink enough water, keep salt low and avoid frequent painkillers without advice.'],
});
disease(['Liver Cirrhosis', 'Cirrhosis'], 'Long-term scarring of the liver.', {
  plain: 'liver scarring (cirrhosis)', check: 'liver function test every year', w: 1.4,
  tips: ['Keep alcohol to a minimum or avoid it, and keep a healthy weight to prevent fatty liver.'],
});
disease(['Biliary Cirrhosis', 'Primary Biliary Cirrhosis'], 'Slow damage to the small bile ducts of the liver.', {
  plain: 'a bile-duct liver disease', check: 'liver function test every year',
  tips: ['Get a liver function test every year and see a doctor for itching or yellow eyes.'],
});
disease(['Gallstones'], 'Stones that form in the gallbladder and can cause pain after fatty meals.', {
  plain: 'gallstones', tips: ['Avoid crash diets and very fatty meals; eat regular meals with plenty of fibre.'],
});
disease(['Celiac Disease'], 'A condition where gluten (in wheat, barley, rye) damages the gut.', {
  plain: 'celiac disease', check: 'celiac blood test (tTG) if you have gut symptoms',
  tips: ['If wheat gives you bloating, loose stools or tiredness, ask for a celiac blood test before cutting gluten.'],
});
disease(["Crohn's Disease", 'Crohns Disease'], 'Long-term swelling of the gut.', { plain: "Crohn's disease (gut inflammation)", tips: ['See a doctor for long-lasting stomach pain, loose stools or blood in stools.'] });
disease(['Ulcerative Colitis'], 'Long-term swelling of the large bowel.', { plain: 'ulcerative colitis (bowel inflammation)', tips: ['See a doctor for long-lasting loose stools or blood in stools.'] });
disease(["Parkinson's", "Parkinson's Disease"], 'A condition that affects movement, causing shaking and stiffness.', { plain: "Parkinson's disease", tips: ['Stay physically active: regular exercise protects the brain.'] });
disease(["Alzheimer's", "Alzheimer's Disease"], 'A condition that slowly affects memory and thinking.', {
  plain: "Alzheimer's disease", w: 1.3,
  tips: ['Keep your brain and body active: daily exercise, reading, learning new skills and staying social.', 'Control blood pressure, sugar and cholesterol: what helps the heart helps the brain.'],
});
disease(['Multiple Sclerosis'], 'A condition where the immune system affects the nerves.', { plain: 'multiple sclerosis', tips: ['Keep vitamin D in the normal range and do not smoke.'], check: 'Vitamin D test' });
disease(['Schizophrenia'], 'A mental-health condition that affects thinking and perception.', { plain: 'schizophrenia', tips: ['Avoid cannabis and other drugs, and seek help early for changes in mood or thinking.'] });
disease(['Bipolar Disorder'], 'A mental-health condition with big swings in mood.', { plain: 'bipolar disorder', tips: ['Keep a regular sleep routine and seek help early for big mood swings.'] });
disease(['Migraine'], 'Repeated severe headaches, often with sensitivity to light.', {
  plain: 'migraine', area: 'mind', w: 0.8,
  tips: ['Keep a headache diary to find your triggers (missed meals, poor sleep, certain foods).'],
});
disease(['Amyotrophic Lateral Sclerosis', 'ALS'], 'A rare condition that affects the nerves controlling muscles.', { plain: 'ALS (a nerve condition)', w: 0.6 });
disease(['Restless Legs Syndrome'], 'An urge to move the legs, usually at night.', {
  plain: 'restless legs', area: 'mind', w: 0.6, check: 'ferritin (iron store) test',
  tips: ['Keep iron levels normal, cut caffeine in the evening and stretch your legs before bed.'],
});
disease(['Ankylosing Spondylitis'], 'Long-term swelling of the spine joints causing back stiffness.', {
  plain: 'ankylosing spondylitis (spine stiffness)', tips: ['See a doctor for back pain and stiffness that is worse in the morning and better with movement.'],
});
disease(['Rheumatoid Arthritis'], 'A condition where the immune system attacks the joints.', { plain: 'rheumatoid arthritis', tips: ['Do not smoke and see a doctor for painful, swollen joints in the morning.'] });
disease(['Systemic Lupus Erythematosus', 'Lupus'], 'A condition where the immune system attacks the body.', { plain: 'lupus', tips: ['See a doctor for joint pain with rashes or unusual tiredness.'] });
disease(['Asthma'], 'Narrowing of the airways causing wheeze and breathlessness.', { plain: 'asthma', tips: ['Avoid smoke and dust, and see a doctor for repeated cough or wheeze.'] });
disease(['Age Related Macular Degeneration'], 'An eye condition that affects central vision with age.', {
  plain: 'age-related eye damage (macular degeneration)', check: 'eye check-up every 1 to 2 years after 50',
  tips: ['Wear sunglasses outdoors, eat leafy greens and colourful vegetables, and do not smoke.'],
});
disease(['Inflammation (autoimmune risk)', 'Inflammation', 'Autoimmune risk'], 'Long-lasting inflammation in the body, which can lead to joint pain and immune problems.', {
  plain: 'long-term inflammation and autoimmune problems', area: 'fitness', w: 1.1,
  tips: ['Eat an anti-inflammatory diet: vegetables, fruit, nuts, seeds, turmeric; cut fried and processed food.', 'Get 7 to 8 hours of sleep and build in rest days after hard workouts.'],
  check: 'CRP blood test if you have joint pain',
});
disease(['Disc Degeneration'], 'Wear and tear of the cushions (discs) between the bones of the spine.', {
  plain: 'back problems from disc wear', area: 'fitness', w: 1.3,
  tips: ['Strengthen your core and back muscles (plank, bridges, bird-dog) 3 times a week.', 'Lift with bent knees, avoid sitting for long hours and take a break every 30 minutes.'],
});
disease(['Sports Injury - Anterior Cruciate Ligament (ACL) rupture', 'ACL rupture', 'Sports Injury'], 'An injury of a key ligament of the knee, common in sports.', {
  plain: 'a knee ligament (ACL) injury', area: 'fitness',
  tips: ['Warm up for 10 minutes and strengthen thigh, hip and calf muscles before sports.'],
});
E(['Injury Management', 'Injury risk'], {
  area: 'fitness', w: 0.8, what: 'How easily you get injured and recover during exercise.',
  yes: 'You may get exercise injuries more easily or recover more slowly.', no: 'You are likely to recover from injuries normally.',
  tips: ['Increase training slowly (no more than 10% a week) and always warm up and cool down.'],
});

// Cancers: the shared advice plus the screening that fits.
const CANCER = 'Do not smoke, limit alcohol, keep a healthy weight and eat plenty of vegetables and fruit.';
const cancer = (names, what, plain, screen, sex) => disease(names, what, { plain, sex, w: 1.3, check: screen, tips: [CANCER, ...(screen ? [`Ask your doctor about ${screen}.`] : [])] });
cancer(['Colorectal cancer'], 'Cancer of the large bowel.', 'bowel cancer', 'a stool test or colonoscopy from age 45');
cancer(['Lung Cancer'], 'Cancer of the lungs.', 'lung cancer', '');
cancer(['Pancreatic Cancer'], 'Cancer of the pancreas.', 'pancreatic cancer', '');
cancer(['Bladder cancer'], 'Cancer of the urinary bladder.', 'bladder cancer', 'a urine test if you see blood in urine');
cancer(['Melanoma'], 'A skin cancer that starts in pigment cells.', 'melanoma (a skin cancer)', 'a skin check of any changing mole');
cancer(['Basal Cell Carcinoma'], 'A common, slow-growing skin cancer.', 'a common skin cancer', 'a skin check of any spot that does not heal');
cancer(['Renal Cell Carcinoma'], 'Cancer of the kidney.', 'kidney cancer', '');
cancer(['Follicular Lymphoma'], 'A cancer of the lymph glands.', 'a lymph gland cancer', '');
cancer(['Chronic Lymphocytic Leukemia'], 'A slow blood cancer.', 'a slow blood cancer', 'a CBC blood test every year');
cancer(['Hodgkins Lymphoma', "Hodgkin's Lymphoma"], 'A cancer of the lymph glands.', 'a lymph gland cancer', '');
cancer(['Prostate Cancer'], 'Cancer of the prostate gland in men.', 'prostate cancer', 'a PSA blood test from age 50', 'M');
cancer(['Thyroid Cancer'], 'Cancer of the thyroid gland.', 'thyroid cancer', 'a neck check if you notice a lump');
cancer(['Testicular Cancer'], 'Cancer of the testes.', 'testicular cancer', 'a monthly self-check', 'M');
cancer(['Breast Cancer'], 'Cancer of the breast.', 'breast cancer', 'a monthly self-check and a mammogram as your doctor advises', 'F');
E(['PSA Levels', 'PSA'], {
  area: 'health', sex: 'M', w: 0.8, what: 'PSA is a blood marker of the prostate gland.',
  yes: 'Your genes may give you a naturally higher PSA reading.', no: 'Your genes are not likely to raise your PSA reading.',
  tips: ['Tell the doctor about this result when you have a PSA test, so it is read correctly.'],
});

// ---------- Allergies and sensitivities ----------
E(['Lactose Intolerance'], {
  area: 'allergy', w: 1, what: 'Difficulty digesting the sugar in milk (lactose).',
  yes: 'You may not digest milk well; it can cause gas, bloating or loose stools.', high: 'You are very likely to have trouble digesting milk; it can cause gas, bloating or loose stools.',
  no: 'You are likely to digest milk normally.',
  tips: ['Prefer curd, buttermilk, paneer or lactose-free milk over plain milk.', 'Get calcium from ragi, sesame and leafy greens if you cut dairy.'],
});
E(['Gluten Intolerance', 'Gluten Sensitivity'], {
  area: 'allergy', w: 1, what: 'Discomfort after eating gluten (in wheat, barley and rye).',
  yes: 'Wheat and other gluten foods may upset your stomach.', high: 'Wheat and other gluten foods are very likely to upset your stomach.',
  no: 'You are not likely to react to gluten.',
  tips: ['Notice how you feel after wheat; try rice, millets (ragi, jowar, bajra) and besan instead.', 'Ask for a celiac blood test before cutting out gluten completely.'],
});
E(['Peanut Allergy'], {
  area: 'allergy', w: 1, what: 'An allergic reaction to peanuts.',
  yes: 'You may be allergic to peanuts.', no: 'You are not likely to be allergic to peanuts.',
  tips: ['If peanuts ever cause itching, swelling or breathlessness, avoid them and see a doctor; get an allergy test if unsure.'],
});
E(['Alcohol Flush Reaction', 'Alcohol Flush'], {
  area: 'habits', w: 0.8, what: 'Red face and fast heartbeat after drinking alcohol.',
  yes: 'Your body may break down alcohol poorly, causing flushing.', no: 'You are not likely to flush after alcohol.',
  tips: ['Avoid alcohol or keep it rare: flushing means it is more harmful for you.'],
});

// ---------- Fitness ----------
E(['Muscle Performance', 'Muscle Type', 'Power vs Endurance'], {
  area: 'fitness', w: 0.5, what: 'Whether your muscles are built more for power or for endurance.',
  yes: '', no: '',
  info: (r) => /slow-twitch|endurance-based/i.test(r) && !/balance|equal/i.test(r) ? 'Your muscles suit endurance: running, cycling, swimming and long walks.'
    : /fast-twitch|power/i.test(r) && !/balance|equal/i.test(r) ? 'Your muscles suit power: sprints, weights and short, hard sessions.'
      : 'Your muscles suit both power and endurance: mix strength training with cardio.',
});
E(['VO2 Max'], {
  area: 'fitness', w: 0.8, what: 'How well your body uses oxygen during exercise (your stamina).',
  yes: 'Your stamina may build more slowly.', no: 'Your body is likely to build stamina well.',
  tips: ['Build stamina slowly with interval walking or jogging 3 times a week.'],
});
E(['Muscle Fatigue'], {
  area: 'fitness', w: 0.8, what: 'How quickly your muscles tire during exercise.',
  yes: 'Your muscles may tire early during exercise.', no: 'Your muscles are not likely to tire early.',
  tips: ['Keep sessions shorter with rest breaks, drink water and have a protein snack after exercise.'],
});
E(['Exercise time', 'Exercise timing'], {
  area: 'fitness', w: 0.6, what: 'The time of day when exercise suits your body best.',
  yes: 'Your muscles may tire more if you exercise late in the day.', no: 'Any time of day is fine for you to exercise.',
  tips: ['Exercise in the morning where you can; it may reduce strain for you.'],
});
E(['Motivation to Exercise'], {
  area: 'fitness', w: 0.7, what: 'How naturally you feel like exercising.',
  yes: 'You may find it harder to stay motivated to exercise.', no: 'You are likely to have normal motivation to exercise.',
  tips: ['Pick an activity you enjoy, exercise with a friend and track your steps.'],
});
E(['High Altitude Adaptation'], {
  area: 'fitness', w: 0.3, what: 'How easily your body copes with high altitude.',
  yes: 'You may feel altitude sickness more easily.', no: 'You are likely to adjust to altitude normally.',
  tips: ['When travelling to the mountains, climb slowly and rest on the first day.'],
});

// ---------- Mind and sleep ----------
E(['Sleep Duration'], {
  area: 'mind', w: 0.8, what: 'How much sleep your body tends to need.',
  yes: 'You may sleep less than your body needs.', no: 'You are likely to have a normal sleep length.',
  tips: ['Aim for 7 to 8 hours: fixed bedtime, no screens for 30 minutes before bed.'],
});
E(['Sleep Depth', 'Sleep Quality'], {
  area: 'mind', w: 0.8, what: 'How deeply you sleep.',
  yes: 'Your sleep may be lighter than most people\'s.', no: 'You are likely to sleep deeply.',
  tips: ['Keep the bedroom dark and quiet, and avoid tea, coffee and heavy meals after 6 pm.'],
  info: (r) => /less likely to have deep sleep/i.test(r) ? 'Your sleep may be lighter: a dark, quiet room and no tea or coffee after 4 pm help.' : null,
});
E(['Sleep Cycle', 'Circadian rhythm', 'Chronotype'], {
  area: 'mind', w: 0.6, what: 'Your body clock: whether you are a morning or an evening person.',
  yes: 'Your body clock may run late, which can disturb sleep and raise night-time hunger.', no: 'Your body clock is likely to be regular.',
  tips: ['Get morning sunlight, keep the same wake-up time every day and avoid late-night eating.'],
  info: (r) => /delay|late|evening/i.test(r) ? 'Your body clock may run late: morning sunlight, a fixed wake-up time and no late-night snacks help.' : null,
});
E(['Memory'], {
  area: 'mind', w: 0.4, what: 'Your natural memory ability.',
  yes: 'Your memory may need a little more support.', no: 'Your genes support a good memory.',
  tips: ['Sleep well, exercise and use notes or reminders for important tasks.'],
  ok: (r) => /exceptional|very good|better/i.test(r) ? 'A strong memory' : null,
});
E(['Learning Capacity'], {
  area: 'mind', w: 0.4, what: 'How you learn best.',
  yes: 'You may learn better with repetition and practice.', no: 'Your genes support learning from feedback.',
  tips: ['Learn in short sessions with practice and review.'],
  ok: (r) => /very good|better/i.test(r) ? 'Learning well from feedback' : null,
});
E(['Resilience', 'Resilience (Personality)', 'Stress resilience'], {
  area: 'mind', w: 0.7, what: 'How well you cope with stress.',
  yes: 'Stress may affect you more than others.', no: 'You are likely to cope well with stress.',
  tips: ['Take 10 minutes a day for deep breathing, yoga or a walk, and talk to someone you trust when stressed.'],
  ok: (r) => /resil/i.test(r) ? 'Coping well with stress' : null,
});

// ---------- Habits ----------
const habit = (names, what, thing, tips, w = 1) => E(names, {
  area: 'habits', w, what,
  yes: `You may get hooked on ${thing} more easily than others.`, high: `You are very likely to get hooked on ${thing} more easily than others.`,
  no: `You are not likely to get hooked on ${thing} easily.`, tips,
});
habit(['Nicotine Addiction', 'Smoking addiction'], 'How easily you could become dependent on tobacco.', 'tobacco (cigarettes, gutka, vaping)',
  ['Never start smoking or chewing tobacco; if you use it, ask us about quit support now.', 'Avoid situations where others smoke.'], 1.3);
habit(['Alcohol Addiction', 'Alcohol dependence'], 'How easily you could become dependent on alcohol.', 'alcohol',
  ['Keep alcohol to special occasions only, and set a limit before you start.', 'Keep 3 or more alcohol-free days every week.'], 1.3);
habit(['Caffeine Addiction', 'Caffeine'], 'How easily you could become dependent on caffeine.', 'tea and coffee',
  ['Keep tea or coffee to 2 cups a day and none after 4 pm.'], 0.6);

// ---------- Skin and hair ----------
const SPF = 'Use sunscreen (SPF 30 or more) every day, even indoors near windows, and reapply every 3 hours outdoors.';
const skin = (names, what, yes, no, tips, w = 0.8) => E(names, { area: 'skin', w, what, yes, no, tips });
skin(['Sun burns', 'Sunburn', 'Sun burn'], 'How easily your skin burns in the sun.', 'Your skin may burn easily in the sun.', 'Your skin is not likely to burn easily.', [SPF, 'Wear a hat or cover up between 11 am and 3 pm.']);
skin(['Tanning'], 'How easily your skin darkens in the sun.', 'Your skin may tan easily.', 'Your skin is not likely to tan easily.', [SPF]);
skin(['Freckling', 'Freckles'], 'How easily you get freckles.', 'You may get freckles easily.', 'You are not likely to get freckles.', [SPF]);
skin(['Teenage Acne', 'Acne'], 'Your tendency to get pimples.', 'You may get pimples more easily.', 'You are not likely to get pimples easily.', ['Wash your face twice a day with a mild cleanser and avoid oily creams; see a dermatologist if pimples leave marks.']);
skin(['Collagen Quality', 'Collagen Degradation', 'Collagen'], 'Collagen keeps skin firm and smooth.', 'Your skin may lose collagen faster, so firmness can drop earlier.', 'Your skin is likely to keep its collagen well.', [SPF, 'Eat vitamin C foods daily (amla, guava, citrus) and enough protein to support collagen.'], 1);
skin(['Skin Elasticity', 'Skin Sagging'], 'How well your skin springs back.', 'Your skin may lose its stretch earlier.', 'Your skin is likely to stay elastic.', ['Moisturise daily, protect from sun and avoid smoking.'], 1);
skin(['Wrinkles', 'Skin Aging', 'Skin Ageing', 'Photoaging', 'Sun Damage'], 'How early lines and sun damage appear.', 'Fine lines and sun damage may appear earlier on your skin.', 'Your skin is likely to age at a normal pace.', [SPF, 'Ask a dermatologist about a gentle retinoid or vitamin C serum.'], 1);
skin(['Glycation', 'Sugar Damage'], 'Damage to skin proteins from high sugar, which makes skin dull and less firm.', 'Sugar may damage your skin more than others.', 'Sugar is not likely to affect your skin much.', ['Cut sweets, sugary drinks and maida; they speed up skin ageing for you.'], 0.9);
skin(['Pigmentation', 'Hyperpigmentation', 'Sun Spots', 'Age Spots', 'Melasma'], 'Dark patches or spots on the skin.', 'You may get dark spots or patches more easily.', 'You are not likely to get dark spots easily.', [SPF, 'Do not pick pimples or scratch; ask a dermatologist before using skin-lightening creams.'], 1);
skin(['Stretch Marks'], 'Lines that appear when skin stretches fast.', 'You may get stretch marks more easily.', 'You are not likely to get stretch marks easily.', ['Avoid fast weight changes and keep skin moisturised.'], 0.5);
skin(['Cellulite'], 'Dimpled skin, usually on the thighs.', 'You may get cellulite more easily.', 'You are not likely to get cellulite easily.', ['Strength training and a healthy weight reduce cellulite.'], 0.4);
skin(['Skin Hydration', 'Dry Skin', 'Skin Barrier'], 'How well your skin holds moisture.', 'Your skin may dry out easily.', 'Your skin is likely to hold moisture well.', ['Use a fragrance-free moisturiser after bathing and avoid very hot showers.'], 0.8);
skin(['Skin Sensitivity', 'Sensitive Skin'], 'How easily your skin reacts to products or weather.', 'Your skin may react easily to products and weather.', 'Your skin is not likely to be sensitive.', ['Use mild, fragrance-free products and patch-test anything new.'], 0.7);
skin(['Rosacea'], 'Redness and flushing of the face.', 'You may get facial redness or flushing.', 'You are not likely to get rosacea.', ['Avoid very spicy food, hot drinks and alcohol if they make your face flush.'], 0.6);
skin(['Atopic Dermatitis', 'Eczema'], 'Dry, itchy, inflamed skin (eczema).', 'You may get eczema (dry, itchy skin) more easily.', 'You are not likely to get eczema.', ['Moisturise twice a day and use mild soap-free cleansers.'], 0.8);
skin(['Psoriasis'], 'Thick, scaly patches on the skin.', 'You may get psoriasis more easily.', 'You are not likely to get psoriasis.', ['See a dermatologist early for any scaly patches; avoid smoking and keep a healthy weight.'], 0.8);
skin(['Vitiligo'], 'White patches where skin loses its colour.', 'You may get white patches more easily.', 'You are not likely to get vitiligo.', ['See a dermatologist early if you notice white patches.'], 0.6);
skin(['Hair Loss', 'Hair Thinning'], 'Thinning of hair on the scalp.', 'Your hair may thin earlier.', 'Your hair is not likely to thin early.', ['Eat enough protein, iron and zinc, and see a dermatologist early if hair thins.'], 0.8);
skin(['Male Pattern Baldness'], 'Hair loss at the temples and crown in men.', 'You may lose hair at the temples and crown earlier.', 'You are not likely to have early male-pattern hair loss.', ['See a dermatologist early; treatment works best when started early.'], 0.7);
skin(['Premature Greying', 'Grey Hair', 'Hair Greying'], 'Hair turning grey early.', 'Your hair may turn grey earlier.', 'Your hair is not likely to grey early.', ['Keep vitamin B12, iron and copper levels normal and avoid smoking.'], 0.4);
skin(['Dandruff'], 'Flaking of the scalp.', 'You may get dandruff more easily.', 'You are not likely to get dandruff.', ['Use an anti-dandruff shampoo twice a week.'], 0.4);
skin(['Antioxidant Capacity', 'Oxidative Stress', 'Antioxidants'], 'How well your skin and body fight damage from sun and pollution.', 'Your body may fight sun and pollution damage less well.', 'Your body is likely to fight sun and pollution damage well.', ['Eat colourful fruits and vegetables daily (berries, tomatoes, carrots, greens) and drink green tea.'], 0.9);
skin(['Eyebrow Thickness'], 'Natural eyebrow thickness.', '', '', [], 0);

// ---------- Longevity ----------
E(['Healthy Aging', 'Healthy Ageing', 'Longevity'], {
  area: 'health', w: 1.2, what: 'How well you are likely to age.',
  yes: 'You may need more lifestyle support to age healthily.', no: 'Your genes support healthy ageing.',
  tips: ['Stay active every day, eat mostly plants and keep up yearly check-ups.'],
  ok: () => 'Genes that support healthy ageing',
});
E(['Iron Overload', 'Haemochromatosis', 'Hemochromatosis'], {
  area: 'food', w: 1.2, what: 'Storing too much iron in the body.',
  yes: 'Your body may store too much iron.', no: 'Your body is not likely to store too much iron.',
  tips: ['Do not take iron supplements unless a blood test shows you need them.'],
  check: 'ferritin and transferrin saturation test',
});

function lookup(name) {
  const k = norm(name);
  if (!k) return null;
  for (const e of ENTRIES) if (e.names.some((n) => norm(n) === k)) return e;
  // A partner name that adds words, such as "Low Density Cholesterol Levels (LDL)".
  for (const e of ENTRIES) if (e.names.some((n) => norm(n).length >= 5 && (k.startsWith(norm(n)) || norm(n).startsWith(k)))) return e;
  return null;
}

module.exports = { AREAS, ENTRIES, lookup, norm };
